import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { noteFieldDefinitions, type ManagedNote } from "./collection-model";
import { classifyConversion, validateFieldValue, type FieldDefinition } from "./field-values";
import { locateBodyBlocks } from "./markdown-headings";
import { linkedNotePath } from "./note-links";
import { namePart, resolveStoragePath } from "./storage";
import { readCollectionModel, validateCollection } from "./validator";

type Data = Record<string, unknown>;
const BLOCK_INFO = "typedmark-preserved";

export interface PreservedSection {
  heading: string;
  markdown: string;
}
export interface PreservedEntry {
  from: string;
  fields?: Data;
  sections?: PreservedSection[];
}
export interface RetypeIssue {
  rule: string;
  message: string;
}
export interface RetypeOptions {
  /** Explicit source-to-target field names (RT-2). */
  map?: Record<string, string>;
  /** Values supplied by the caller for requirements the conversion cannot satisfy. */
  values?: Data;
}
export interface RetypePlan {
  path: string;
  targetPath: string;
  from: string;
  to: string;
  carried: string[];
  preservedFields: string[];
  preservedSections: string[];
  restoredFields: string[];
  restoredSections: string[];
  addedTags: string[];
  addedHeadings: string[];
  unresolved: RetypeIssue[];
  /** The note as it would be written; absent when the plan cannot be applied. */
  content?: string;
}

/**
 * Plan converting one managed note to another concrete type without losing
 * information (Note Re-typing, RT-1..RT-20). The plan is validated on a staged
 * copy of the collection; nothing is written here.
 */
export function planRetype(collectionRoot: string, schemaDirectory: string, notePath: string, to: string, options: RetypeOptions = {}): RetypePlan {
  const model = readCollectionModel({ collectionRoot, schemaDirectory, mode: "instantiated_collection" });
  const path = notePath.normalize("NFC");
  const note = model.notes.find((candidate) => candidate.path.normalize("NFC") === path);
  const plan: RetypePlan = {
    path,
    targetPath: path,
    from: note?.noteType ?? "",
    to,
    carried: [],
    preservedFields: [],
    preservedSections: [],
    restoredFields: [],
    restoredSections: [],
    addedTags: [],
    addedHeadings: [],
    unresolved: [],
  };
  const unresolved = (rule: string, message: string) => plan.unresolved.push({ rule, message });
  const target = model.schemas.get(to);
  if (!note) unresolved("RT-1", `${notePath} is not a managed note`);
  if (!target || target.abstract || model.schemaIssues?.has(to)) unresolved("RT-1", `${to} is not a valid concrete note type`);
  if (!note || !target || plan.unresolved.length) return plan;
  if (note.noteType === to) {
    unresolved("RT-1", `${notePath} already has type ${to}`);
    return plan;
  }

  const timezone = String(model.config.timezone ?? "UTC");
  const vocabularies = model.config.vocabularies;
  const targetFields = noteFieldDefinitions(target);
  const compatible = (value: unknown, source: FieldDefinition | undefined, definition: FieldDefinition) =>
    !Object.hasOwn(definition, "computed") &&
    classifyConversion(source ?? { type: "any" }, definition) !== "incompatible" &&
    !validateFieldValue(value, definition, timezone, vocabularies);

  // Existing preservation block (RT-13, RT-18): parse it before moving content.
  const blocks = locateBodyBlocks(note.body);
  const preservation = blocks.filter((block) => block.kind === "code" && block.info === BLOCK_INFO);
  if (preservation.length > 1) unresolved("RT-13", "The note has more than one preservation block");
  let entries: PreservedEntry[] = [];
  if (preservation[0]) {
    try {
      const parsed = parse(preservation[0].literal ?? "", { version: "1.2", schema: "core" });
      if (!Array.isArray(parsed)) throw new Error("not a list");
      entries = parsed as PreservedEntry[];
    } catch (error) {
      unresolved("RT-20", `The preservation block cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (plan.unresolved.length) return plan;

  // Fields (RT-2..RT-5).
  const stored: Data = Object.create(null);
  const preservedFields: Data = Object.create(null);
  for (const [name, value] of Object.entries(note.stored)) {
    if (name === "note_type") continue;
    const targetName = options.map?.[name] ?? name;
    const definition = Object.hasOwn(targetFields, targetName) ? targetFields[targetName] : undefined;
    if (definition && compatible(value, note.fields[name], definition)) {
      stored[targetName] = value;
      plan.carried.push(name === targetName ? name : `${name} -> ${targetName}`);
    } else {
      preservedFields[name] = value;
      plan.preservedFields.push(name);
    }
  }
  if (note.values.id !== undefined && note.values.id !== null && stored.id === undefined) stored.id = note.values.id;

  // Restore an earlier entry when converting back to its source type (RT-19).
  const restoredSections: PreservedSection[] = [];
  const back = entries.findLastIndex((entry) => entry?.from === to);
  if (back >= 0) {
    const entry = entries[back]!;
    for (const [name, value] of Object.entries(entry.fields ?? {})) {
      const definition = Object.hasOwn(targetFields, name) ? targetFields[name] : undefined;
      if (Object.hasOwn(stored, name) || !definition || !compatible(value, undefined, definition)) continue;
      stored[name] = value;
      delete entry.fields![name];
      plan.restoredFields.push(name);
    }
    restoredSections.push(...(entry.sections ?? []));
    entries[back] = entry;
  }
  for (const [name, value] of Object.entries(options.values ?? {})) stored[name] = value;

  // Mandatory tags (RT-6).
  const mandatory = [...((model.config.mandatory_tags as string[]) ?? []), ...((target.mandatory_tags as string[]) ?? [])];
  const tags = Array.isArray(stored.tags) ? [...(stored.tags as string[])] : [];
  for (const tag of mandatory) if (!tags.some((existing) => existing.normalize("NFC") === tag.normalize("NFC"))) tags.push(tag), plan.addedTags.push(tag);
  if (plan.addedTags.length) stored.tags = tags;

  // Body sections (RT-7, RT-8). Lines are 1-based in block positions.
  const lines = note.body.split("\n");
  const headings = blocks.filter((block) => block.kind === "heading" && block.depth === 2);
  const required = ((target.headings?.required_h2 as string[]) ?? []).map((heading) => heading.normalize("NFC"));
  const optional = ((target.headings?.optional_h2 as string[]) ?? []).map((heading) => heading.normalize("NFC"));
  const permitted = (heading: string) => target.headings?.allow_other_h2 !== false || required.includes(heading) || optional.includes(heading);
  const removed = new Set<number>();
  const blockLines = preservation[0] ? range(preservation[0].startLine, preservation[0].endLine) : [];
  for (const line of blockLines) removed.add(line);
  const sections: PreservedSection[] = [];
  headings.forEach((heading, index) => {
    const text = heading.text!.normalize("NFC");
    if (permitted(text)) return;
    const end = (headings[index + 1]?.startLine ?? lines.length + 1) - 1;
    const content = range(heading.endLine + 1, end).filter((line) => !removed.has(line));
    sections.push({ heading: heading.text!, markdown: trimBlankEdges(content.map((line) => lines[line - 1]!)).join("\n") });
    for (const line of [...range(heading.startLine, heading.endLine), ...content]) removed.add(line);
  });
  plan.preservedSections.push(...sections.map((section) => section.heading));
  const kept = lines.filter((_, index) => !removed.has(index + 1));
  let body = trimBlankEdges(kept).join("\n");
  // Restored sections leave the entry; sections the target still forbids stay preserved.
  if (back >= 0) entries[back]!.sections = restoredSections.filter((section) => !permitted(section.heading.normalize("NFC")));
  for (const section of restoredSections) {
    if (!permitted(section.heading.normalize("NFC"))) continue;
    body += `${body ? "\n\n" : ""}## ${section.heading}\n${section.markdown ? `\n${section.markdown}` : ""}`;
    plan.restoredSections.push(section.heading);
  }
  const present = new Set(
    locateBodyBlocks(body)
      .filter((block) => block.kind === "heading" && block.depth === 2)
      .map((block) => block.text!.normalize("NFC")),
  );
  for (const heading of required) {
    if (present.has(heading)) continue;
    body += `${body ? "\n\n" : ""}## ${heading}\n`;
    plan.addedHeadings.push(heading);
  }

  // Preservation block (RT-13..RT-18).
  const entry: PreservedEntry = { from: note.noteType };
  if (Object.keys(preservedFields).length) entry.fields = { ...preservedFields };
  if (sections.length) entry.sections = sections;
  const remaining = entries.filter((existing) => Object.keys(existing.fields ?? {}).length || (existing.sections ?? []).length);
  if (entry.fields || entry.sections) remaining.push(entry);
  if (remaining.length) body = `${body.replace(/\n+$/u, "")}\n\n${preservationBlock(remaining)}`;

  // Target path (RT-9): the reference tool moves only when inbound links stay valid.
  const frontmatter: Data = { note_type: to, ...stored };
  const effective: Data = { ...frontmatter };
  for (const [name, definition] of Object.entries(targetFields)) {
    if (!Object.hasOwn(effective, name) && Object.hasOwn(definition, "default_value")) effective[name] = definition.default_value;
  }
  // An unstored title keeps the source note's effective name-part title (NTS-192).
  if (effective.title === undefined)
    effective.title = typeof note.values.title === "string" ? note.values.title : (path.split("/").pop() ?? "").replace(/\.md$/u, "");
  const storage = effective.archived === true && target.storage?.archive ? target.storage.archive : target.storage;
  const sourceSchema = model.schemas.get(note.noteType)!;
  const sourceStorage = note.values.archived === true && sourceSchema.storage?.archive ? sourceSchema.storage.archive : sourceSchema.storage;
  const linked = linkedNotePath(model, path);
  const source = namePart(sourceStorage, path, note.values, note.fields, timezone, linked);
  // A decoration the note carried stays when the target also makes it optional (NTS-191).
  const carried = {
    prefix: source.prefix && sourceStorage?.note_name_prefix?.optional === true,
    suffix: source.suffix && sourceStorage?.note_name_suffix?.optional === true,
  };
  const resolved = resolveStoragePath(storage, effective, targetFields, timezone, source.name, linked, carried);
  if ("failure" in resolved) {
    unresolved(resolved.failure.rule, `Target path: ${resolved.failure.message}`);
    return plan;
  }
  plan.targetPath = resolved.path;
  if (plan.targetPath !== path) checkMove(model.notes, collectionRoot, path, plan.targetPath, unresolved);

  plan.content = `---\n${stringify(frontmatter, { version: "1.2" })}---\n${body ? `\n${body.replace(/\n*$/u, "\n")}` : ""}`;
  if (!plan.unresolved.length) stageAndValidate(collectionRoot, schemaDirectory, plan, unresolved);
  if (plan.unresolved.length) delete plan.content;
  return plan;
}

/** Apply a plan with no unresolved requirements; the old file is replaced in one rename (RT-12). */
export function applyRetype(collectionRoot: string, plan: RetypePlan): void {
  if (plan.unresolved.length || plan.content === undefined) throw new Error("The re-typing plan has unresolved requirements");
  const target = join(collectionRoot, plan.targetPath);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.typedmark-retype`;
  writeFileSync(temporary, plan.content);
  renameSync(temporary, target);
  if (plan.targetPath !== plan.path) rmSync(join(collectionRoot, plan.path));
}

function preservationBlock(entries: PreservedEntry[]): string {
  const yaml = stringify(entries, { version: "1.2", aliasDuplicateObjects: false });
  const longest = Math.max(0, ...[...yaml.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${BLOCK_INFO}\n${yaml}${fence}\n`;
}

// Name-based links keep resolving when only the folder changes; path-formed
// references would need rewriting, which this reference tool does not do.
function checkMove(notes: ManagedNote[], root: string, from: string, to: string, unresolved: (rule: string, message: string) => void) {
  const name = (value: string) => (value.split("/").pop() ?? "").replace(/\.md$/u, "");
  if (name(from) !== name(to)) {
    unresolved("RT-9", `Renaming ${from} to ${to} would require rewriting links, which this tool does not do`);
    return;
  }
  if (notes.some((other) => other.path.normalize("NFC") === to.normalize("NFC"))) unresolved("NTS-152", `${to} is occupied`);
  const stem = from.replace(/\.md$/u, "");
  for (const other of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!other.isFile() || !other.name.endsWith(".md")) continue;
    const relative = join(other.parentPath, other.name)
      .slice(root.length + 1)
      .replaceAll("\\", "/");
    if (relative === from) continue;
    const text = readFileSync(join(other.parentPath, other.name), "utf8");
    if (text.includes(`${stem}]]`) || text.includes(`${stem}|`) || text.includes(`${stem}#`) || text.includes(`(${stem}.md`) || text.includes(`(${from}`)) {
      unresolved("RT-9", `${relative} links to ${from} by path; moving to ${to} would require rewriting it`);
    }
  }
}

function stageAndValidate(root: string, schemaDirectory: string, plan: RetypePlan, unresolved: (rule: string, message: string) => void) {
  const stage = mkdtempSync(join(tmpdir(), "typedmark-retype-"));
  try {
    cpSync(root, stage, { recursive: true, filter: (source) => !source.split(/[\\/]/u).includes(".git") });
    if (plan.targetPath !== plan.path) rmSync(join(stage, plan.path));
    const target = join(stage, plan.targetPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, plan.content!);
    const report = validateCollection({ collectionRoot: stage, schemaDirectory, mode: "instantiated_collection" });
    for (const result of report.results) {
      if (result.severity === "error" && result.path === plan.targetPath) unresolved(result.rule_id, `${result.code}: ${result.message}`);
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function range(start: number, end: number): number[] {
  return end < start ? [] : Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]!.trim()) start++;
  while (end > start && !lines[end - 1]!.trim()) end--;
  return lines.slice(start, end);
}
