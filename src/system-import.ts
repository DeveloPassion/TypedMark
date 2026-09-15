import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseMarkdownWithNodes } from "./frontmatter";
import { expandObjectDefaults, isMapping } from "./field-values";
import { noteFieldDefinitions } from "./collection-model";
import { materializeStarters, MaterializationError, type StarterInput } from "./materialization";
import { readStableCollection } from "./snapshot";
import { resolveStoragePath } from "./storage";
import { deriveStarter, resolveTemplate } from "./templates";
import { readCollectionModel } from "./validator";

/** Prepare source-owned bytes and new notes before creating a destination. */
export function prepareSystem(sourceRoot: string, schemaDirectory: string) {
  const includePaths = readdirSync(sourceRoot).filter((name) => /^(?:licen[cs]es?|notices?|copying|copyright|authors|attribution)(?:$|[._-])/iu.test(name));
  return readStableCollection(sourceRoot, (root, info) => {
    const model = readCollectionModel({ collectionRoot: root, schemaDirectory, mode: "system_definition" }, { diagnosticPolicy: "strict", blockedPaths: info.blockedPaths });
    if (!model.report.valid || model.configurationIssue || model.associationIssue) throw new Error(`Source system is not conforming: ${JSON.stringify(model.report.results)}`);
    const document = parseMarkdownWithNodes(readFileSync(join(root, "typedmark.md")), { preserveBodyLineEndings: true });
    const config = document.data;
    if (!document.frontmatter || typeof config.name !== "string" || typeof config.version !== "string" || !isMapping(config.scaffold)) throw new Error("Source is not a versioned system definition");
    const declaredMetadata = typeof config.metadata_directory === "string" ? config.metadata_directory : ".typedmark";
    const metadataEntry = readdirSync(root, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.normalize("NFC") === declaredMetadata.normalize("NFC"));
    const metadataDirectory = metadataEntry?.name ?? declaredMetadata;
    const files = new Map<string, Buffer>();
    const directories = new Set<string>();
    const capture = (path: string) => {
      const absolute = join(root, path), entry = lstatSync(absolute);
      if (entry.isSymbolicLink()) throw new Error(`System import refuses symbolic link: ${path}`);
      if (entry.isDirectory()) { directories.add(path); for (const child of readdirSync(absolute)) capture(`${path}/${child}`); }
      else if (entry.isFile()) files.set(path, readFileSync(absolute));
      else throw new Error(`System import refuses non-file artifact: ${path}`);
    };
    if (metadataEntry) capture(metadataDirectory);
    for (const path of includePaths) capture(path);
    const starters: StarterInput[] = [];
    const derivedBodies = new Set<string>();
    for (const entry of Array.isArray(config.scaffold.notes) ? config.scaffold.notes : []) {
      if (!isMapping(entry) || typeof entry.note_type !== "string" || typeof entry.path !== "string") throw new MaterializationError("SCE-15", "Malformed scaffold note");
      if (Object.hasOwn(entry, "values") && !isMapping(entry.values)) throw new MaterializationError("SCE-128", "Scaffold values must be a mapping");
      const schema = model.schemas.get(entry.note_type)!;
      const selected = resolveTemplate(root, metadataDirectory, entry.note_type, schema, typeof entry.from_template === "string" ? entry.from_template : undefined, info.blockedPaths);
      if (selected.kind === "invalid") throw new MaterializationError(selected.rule, selected.message);
      if (selected.kind === "derived") derivedBodies.add(entry.path);
      starters.push({ noteType: entry.note_type, path: entry.path, starter: deriveStarter(schema, model.config, selected.kind === "file" ? selected.document : undefined), values: entry.values as Record<string, unknown> | undefined });
    }
    const notes = materializeStarters(starters, model.schemas, model.config);
    const occupied = new Set(["typedmark.md", ...files.keys()].map((path) => path.normalize("NFC")));
    for (const note of notes) {
      const schema = model.schemas.get(note.noteType)!, fields = noteFieldDefinitions(schema);
      const effective: Record<string, unknown> = Object.create(null);
      for (const [field, definition] of Object.entries(fields)) {
        const value = Object.hasOwn(note.data, field) ? note.data[field] : Object.hasOwn(definition, "default_value") ? definition.default_value
          : field === "note_type" ? note.noteType : field === "title" ? basename(note.path, ".md") : definition.nullable ? null : undefined;
        if (value !== undefined) effective[field] = expandObjectDefaults(value, definition);
      }
      if (schema.headings.require_h1_title && derivedBodies.has(note.path)) {
        if (typeof effective.title !== "string") throw new MaterializationError("RHT-52", "A required H1 needs a concrete title");
        note.body = `# ${effective.title}\n\n${note.body}`;
      }
      const storage = effective.archived === true ? schema.storage.archive ?? schema.storage : schema.storage;
      const resolution = resolveStoragePath(storage, effective, fields, model.config.timezone ?? "UTC");
      if ("failure" in resolution) throw new MaterializationError(resolution.failure.rule, resolution.failure.message);
      if (resolution.path.normalize("NFC") !== note.path.normalize("NFC")) throw new MaterializationError("NTS-148", `Scaffold path ${note.path} differs from effective storage path ${resolution.path}`);
      if (occupied.has(note.path.normalize("NFC"))) throw new MaterializationError("NTS-152", `Scaffold path is occupied: ${note.path}`);
      occupied.add(note.path.normalize("NFC"));
    }
    return { configuration: document.frontmatter, body: document.body, files, directories, notes, metadataDirectory,
      source: { name: config.name, version: config.version }, folders: Array.isArray(config.scaffold.folders) ? config.scaffold.folders as string[] : [] };
  }, { includePaths, rejectMetadataLinks: true, artifactsOnly: true });
}
