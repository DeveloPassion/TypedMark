import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_FIELDS, noteFieldDefinitions, type CollectionNote } from "./collection-model";
import { storageAccepts } from "./automation-rules";
import { validateFieldValue, type FieldDefinition } from "./field-values";
import { parseMarkdownWithNodes } from "./frontmatter";
import { readCollectionModel, validateCollection } from "./validator";

type Data = Record<string, unknown>;
export type Confidence = "high" | "medium" | "low";

export interface TypeCandidate {
  type: string;
  score: number;
  reasons: string[];
}
export interface TypeSuggestion {
  path: string;
  /** The stored note_type, when present but not a known concrete type. */
  stored_type?: string;
  confidence: Confidence;
  candidates: TypeCandidate[];
}

// Weights are deliberately simple so every score is explainable from its reasons.
const WEIGHTS = { spelling: 0.6, path: 0.3, fields: 0.3, validValues: 0.1, mandatoryTags: 0.1, missingRequired: -0.15 };
const HIGH = { score: 0.7, margin: 0.2 };
const MEDIUM = 0.4;

/**
 * Suggest note types for collection notes that associate with none (#119).
 * Suggestions are advice, never conformance: the specification stays
 * deterministic through note-type mappings, and nothing is written here.
 */
export function suggestTypes(collectionRoot: string, schemaDirectory: string): TypeSuggestion[] {
  const model = readCollectionModel({ collectionRoot, schemaDirectory, mode: "instantiated_collection" });
  const managed = new Set(model.notes.map((note) => note.path));
  const timezone = String(model.config.timezone ?? "UTC");
  const types = [...model.schemas].filter(([name, schema]) => !schema.abstract && !model.schemaIssues?.has(name));
  const suggestions: TypeSuggestion[] = [];
  for (const document of model.documents) {
    if (managed.has(document.path) || document.frontmatterValid === false) continue;
    const storedType = typeof document.stored.note_type === "string" ? document.stored.note_type : undefined;
    const candidates = types
      .map(([name, schema]) => score(document, storedType, name, schema, noteFieldDefinitions(schema), model.config, timezone))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || (a.type < b.type ? -1 : 1))
      .slice(0, 3);
    const [best, second] = candidates;
    const confidence: Confidence =
      best && best.score >= HIGH.score && best.score - (second?.score ?? 0) >= HIGH.margin ? "high" : best && best.score >= MEDIUM ? "medium" : "low";
    suggestions.push({ path: document.path, ...(storedType ? { stored_type: storedType } : {}), confidence, candidates });
  }
  return suggestions;
}

function score(
  document: CollectionNote,
  storedType: string | undefined,
  type: string,
  schema: Data,
  fields: Record<string, FieldDefinition>,
  config: Data,
  timezone: string,
): TypeCandidate {
  const reasons: string[] = [];
  let total = 0;
  const add = (weight: number, reason: string) => {
    total += weight;
    reasons.push(reason);
  };
  if (storedType !== undefined) {
    const distance = editDistance(storedType.normalize("NFC").toLowerCase(), type.toLowerCase());
    if (distance <= Math.max(1, Math.floor(type.length / 4))) add(WEIGHTS.spelling, `note_type "${storedType}" is ${distance} edit(s) from "${type}"`);
  }
  const storage = schema.storage as Data | undefined;
  if (storage && [storage, storage.archive].some((branch) => branch && storageAccepts(document.path, branch as Data)))
    add(WEIGHTS.path, "path matches its storage");
  const own = Object.keys(fields).filter((name) => !Object.hasOwn(CORE_FIELDS, name));
  const stored = Object.keys(document.stored).filter((name) => !Object.hasOwn(CORE_FIELDS, name));
  const shared = stored.filter((name) => own.includes(name));
  if (shared.length) {
    const union = new Set([...own, ...stored]).size;
    add(WEIGHTS.fields * (shared.length / union), `shares fields ${shared.join(", ")}`);
    const valid = shared.filter((name) => !validateFieldValue(document.stored[name], fields[name]!, timezone, config.vocabularies as never));
    if (valid.length === shared.length) add(WEIGHTS.validValues, "shared values are valid for it");
  }
  const mandatory = [...((config.mandatory_tags as string[]) ?? []), ...((schema.mandatory_tags as string[]) ?? [])];
  const tags = Array.isArray(document.stored.tags) ? (document.stored.tags as unknown[]).filter((tag): tag is string => typeof tag === "string") : [];
  const typeTags = (schema.mandatory_tags as string[] | undefined) ?? [];
  if (typeTags.length && mandatory.every((tag) => tags.includes(tag))) add(WEIGHTS.mandatoryTags, "carries its mandatory tags");
  const missing = own.filter(
    (name) => fields[name]!.nullable === false && !Object.hasOwn(fields[name]!, "default_value") && !Object.hasOwn(document.stored, name),
  );
  if (total > 0 && missing.length) add(WEIGHTS.missingRequired, `lacks required ${missing.join(", ")}`);
  return { type, score: Math.round(Math.max(0, total) * 100) / 100, reasons };
}

/**
 * Store note_type on notes whose suggestion is high-confidence, keeping each
 * change only when the note then validates without errors. Returns the paths
 * that were typed.
 */
export function applySuggestions(collectionRoot: string, schemaDirectory: string, suggestions: TypeSuggestion[]): string[] {
  const applied: string[] = [];
  for (const suggestion of suggestions) {
    const type = suggestion.confidence === "high" ? suggestion.candidates[0]?.type : undefined;
    if (!type) continue;
    const file = join(collectionRoot, suggestion.path);
    const original = readFileSync(file);
    const document = parseMarkdownWithNodes(original, { preserveBodyLineEndings: true });
    let yaml = `note_type: ${type}\n`;
    if (document.frontmatter) {
      document.frontmatter.set("note_type", type);
      yaml = document.frontmatter.toString();
    }
    writeFileSync(`${file}.typedmark-suggest`, `---\n${yaml}---\n${document.body}`);
    renameSync(`${file}.typedmark-suggest`, file);
    const errors = validateCollection({ collectionRoot, schemaDirectory }).results.filter(
      (result) => result.path === suggestion.path && result.severity === "error",
    );
    if (errors.length) writeFileSync(file, original);
    else applied.push(suggestion.path);
  }
  return applied;
}

// Optimal string alignment distance: insertions, deletions, substitutions and adjacent transpositions.
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1);
    }
  }
  return rows[a.length]![b.length]!;
}
