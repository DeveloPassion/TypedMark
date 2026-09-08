import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { stringify } from "yaml";
import { getCapabilities } from "./adapter";
import { parseMarkdown } from "./frontmatter";
import { SchemaRegistry } from "./schema-registry";
import type { ValidationReport } from "./types";
import { validateCollection } from "./validator";

export interface InstantiateSystemInput {
  sourceRoot: string;
  targetRoot: string;
  collectionName: string;
  description?: string;
  schemaDirectory: string;
}

export interface InstantiationResult {
  source: { name: string; version: string };
  createdPaths: string[];
  report: ValidationReport;
  validateOffline(): ValidationReport;
}

export type MigrationReadiness =
  | { status: "ready"; reasons: [] }
  | { status: "manual_resolution_required"; reasons: string[] };

export async function instantiateSystem(input: InstantiateSystemInput): Promise<InstantiationResult> {
  const sourceRoot = resolve(input.sourceRoot);
  const targetRoot = resolve(input.targetRoot);
  if (existsSync(targetRoot)) throw new Error(`Target already exists: ${targetRoot}`);

  const sourceConfigPath = join(sourceRoot, "typedmark.md");
  assertNoSymbolicLinks(sourceConfigPath);
  const sourceDocument = parseMarkdown(readFileSync(sourceConfigPath, "utf8"));
  const sourceConfig = sourceDocument.data;
  const metadataDirectory = safeMetadataDirectory(sourceConfig.metadata_directory);
  const sourceMetadata = join(sourceRoot, metadataDirectory);
  if (existsSync(sourceMetadata)) assertNoSymbolicLinks(sourceMetadata);

  const capabilities = getCapabilities().extensions;
  const sourceReport = validateCollection({ collectionRoot: sourceRoot, schemaDirectory: input.schemaDirectory, mode: "system_definition", supportedExtensions: capabilities });
  if (!sourceReport.valid) throw new Error(`Source system is not conforming: ${JSON.stringify(sourceReport.results)}`);
  if (typeof sourceConfig.name !== "string" || typeof sourceConfig.version !== "string" || !isRecord(sourceConfig.scaffold)) throw new Error("Source is not a versioned system definition");

  await mkdir(dirname(targetRoot), { recursive: true });
  const stagingRoot = await mkdtemp(join(dirname(targetRoot), ".typedmark-instantiate-"));
  try {
    if (existsSync(sourceMetadata)) await cp(sourceMetadata, join(stagingRoot, metadataDirectory), { recursive: true });

    const targetConfig = structuredClone(sourceConfig);
    targetConfig.name = input.collectionName;
    if (input.description !== undefined) targetConfig.description = input.description;
    delete targetConfig.version;
    delete targetConfig.scaffold;
    targetConfig.composition = { sources: [{ name: sourceConfig.name, version: sourceConfig.version }] };
    await writeFile(join(stagingRoot, "typedmark.md"), serializeMarkdown(targetConfig, `# ${input.collectionName}\n`));

    const createdPaths = ["typedmark.md"];
    for (const folder of strings(sourceConfig.scaffold.folders)) {
      const destination = safeTarget(stagingRoot, folder);
      await mkdir(destination, { recursive: true });
      createdPaths.push(`${normalized(folder)}/`);
    }
    for (const note of Array.isArray(sourceConfig.scaffold.notes) ? sourceConfig.scaffold.notes : []) {
      if (!isRecord(note) || typeof note.path !== "string" || typeof note.note_type !== "string") continue;
      const destination = safeTarget(stagingRoot, note.path);
      await mkdir(dirname(destination), { recursive: true });
      const templateName = typeof note.from_template === "string" ? note.from_template : `${note.note_type}.md`;
      const templatePath = join(stagingRoot, metadataDirectory, "templates", templateName);
      const template = existsSync(templatePath) ? parseMarkdown(readFileSync(templatePath, "utf8")) : { data: {}, body: "", hasFrontmatter: false };
      const values = isRecord(note.values) ? note.values : {};
      const frontmatter = { ...template.data, ...values, note_type: note.note_type };
      await writeFile(destination, serializeMarkdown(frontmatter, template.body));
      createdPaths.push(normalized(relative(stagingRoot, destination)));
    }

    const report = validateCollection({ collectionRoot: stagingRoot, schemaDirectory: input.schemaDirectory, mode: "instantiated_collection", supportedExtensions: capabilities });
    if (!report.valid) throw new Error(`Instantiated collection is not conforming: ${JSON.stringify(report.results)}`);
    await rename(stagingRoot, targetRoot);
    return {
      source: { name: sourceConfig.name, version: sourceConfig.version },
      createdPaths: createdPaths.sort(),
      report,
      validateOffline: () => validateCollection({ collectionRoot: targetRoot, schemaDirectory: input.schemaDirectory, mode: "instantiated_collection", supportedExtensions: capabilities }),
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

export function checkMigrationReadiness(input: { systemRoot: string; fromVersion: string; schemaDirectory: string }): MigrationReadiness {
  const root = resolve(input.systemRoot);
  const config = parseMarkdown(readFileSync(join(root, "typedmark.md"), "utf8")).data;
  const targetVersion = String(config.version ?? "");
  if (targetVersion === input.fromVersion) return { status: "ready", reasons: [] };
  const metadataDirectory = safeMetadataDirectory(config.metadata_directory);
  const historyPath = join(root, metadataDirectory, "history.md");
  if (!existsSync(historyPath)) return {
    status: "manual_resolution_required",
    reasons: [`The target system has no history.md for classifying the ${input.fromVersion} to ${targetVersion} update.`],
  };
  try {
    const history = parseMarkdown(readFileSync(historyPath, "utf8")).data;
    const errors = new SchemaRegistry(input.schemaDirectory).validate("history.schema.json", history);
    const entries = Array.isArray(history.history) ? history.history : [];
    if (errors.length > 0 || entries.at(-1)?.version !== targetVersion || !entries.some((entry) => entry.version === input.fromVersion)) {
      return { status: "manual_resolution_required", reasons: ["The target system history is invalid or incomplete for this update."] };
    }
    return { status: "ready", reasons: [] };
  } catch {
    return { status: "manual_resolution_required", reasons: ["The target system history cannot be interpreted for this update."] };
  }
}

function serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const normalizedBody = body.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n+$/g, "");
  return `---\n${stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n${normalizedBody ? `\n${normalizedBody}\n` : ""}`;
}

function safeTarget(root: string, requestedPath: string): string {
  const target = resolve(root, requestedPath);
  const relativePath = relative(resolve(root), target);
  if (relativePath === ".." || relativePath.startsWith(`..\\`) || relativePath.startsWith("../") || isAbsolute(relativePath)) throw new Error(`Path escapes target root: ${requestedPath}`);
  return target;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalized(path: string): string { return path.replaceAll("\\", "/"); }

function safeMetadataDirectory(value: unknown): string {
  return typeof value === "string" && value !== "." && value !== ".." && /^[^/\\]+$/.test(value) ? value : ".typedmark";
}

function assertNoSymbolicLinks(path: string): void {
  const details = lstatSync(path);
  if (details.isSymbolicLink()) throw new Error(`System import refuses symbolic link: ${path}`);
  if (!details.isDirectory()) return;
  for (const entry of readdirSync(path)) assertNoSymbolicLinks(join(path, entry));
}
