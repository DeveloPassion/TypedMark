import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { stringify } from "yaml";
import { getCapabilities } from "./adapter";
import { parseMarkdown } from "./frontmatter";
import type { ValidationReport } from "./types";
import { readCollectionModel, validateCollection } from "./validator";
import { readStableCollection } from "./snapshot";
import { prepareSystem } from "./system-import";
import { instantiateConfiguration } from "./system-configuration";

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

// "ready" is limited to a validated target with no requested version change;
// this command cannot certify target-collection impact or apply an update.
export type MigrationReadiness =
  | { status: "ready"; reasons: [] }
  | { status: "manual_resolution_required"; reasons: string[] };

export async function instantiateSystem(input: InstantiateSystemInput): Promise<InstantiationResult> {
  const sourceRoot = resolve(input.sourceRoot);
  const targetRoot = resolve(input.targetRoot);
  if (lstatSync(targetRoot, { throwIfNoEntry: false })) throw new Error(`Target already exists: ${targetRoot}`);
  let existingParent = dirname(targetRoot);
  while (!existsSync(existingParent)) existingParent = dirname(existingParent);
  const physicalTarget = resolve(realpathSync(existingParent), relative(existingParent, targetRoot));
  const targetFromSource = relative(realpathSync(sourceRoot), physicalTarget);
  if (!targetFromSource || (targetFromSource !== ".." && !targetFromSource.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(targetFromSource))) {
    throw new Error("The import target must be outside the source system");
  }

  const capabilities = getCapabilities().extensions;
  const prepared = prepareSystem(sourceRoot, input.schemaDirectory);

  await mkdir(dirname(targetRoot), { recursive: true });
  const stagingRoot = await mkdtemp(join(dirname(targetRoot), ".typedmark-instantiate-"));
  try {
    for (const path of prepared.directories) await mkdir(safeTarget(stagingRoot, path), { recursive: true });
    for (const [path, bytes] of prepared.files) await writeFile(safeTarget(stagingRoot, path), bytes, { flag: "wx" });

    const configuration = instantiateConfiguration(prepared.configuration, { name: input.collectionName, description: input.description, source: prepared.source });
    await writeFile(join(stagingRoot, "typedmark.md"), `---\n${configuration}---\n${prepared.body}`, { flag: "wx" });

    const createdPaths = ["typedmark.md"];
    for (const folder of prepared.folders) {
      const destination = safeTarget(stagingRoot, folder);
      await mkdir(destination, { recursive: true });
      createdPaths.push(`${normalized(folder)}/`);
    }
    for (const note of prepared.notes) {
      const destination = safeTarget(stagingRoot, note.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, serializeMarkdown(note.data, note.body), { flag: "wx" });
      createdPaths.push(normalized(relative(stagingRoot, destination)));
    }

    const target = readStableCollection(stagingRoot, (root, info) => readCollectionModel({ collectionRoot: root, schemaDirectory: input.schemaDirectory, mode: "instantiated_collection", supportedExtensions: capabilities }, { diagnosticPolicy: "strict", blockedPaths: info.blockedPaths }));
    const report = target.report;
    if (!report.valid) throw new Error(`Instantiated collection is not conforming: ${JSON.stringify(report.results)}`);
    for (const note of prepared.notes) if (!target.notes.some((actual) => actual.path === note.path.normalize("NFC") && actual.noteType === note.noteType)) throw new Error(`MN-120: Scaffold note ${note.path} is not managed as ${note.noteType}`);
    if (lstatSync(targetRoot, { throwIfNoEntry: false })) throw new Error(`Target already exists: ${targetRoot}`);
    await rename(stagingRoot, targetRoot);
    return {
      source: prepared.source,
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
  try {
    return readStableCollection(resolve(input.systemRoot), (root, info): MigrationReadiness => {
      const model = readCollectionModel({ collectionRoot: root, schemaDirectory: input.schemaDirectory, mode: "system_definition" }, { diagnosticPolicy: "strict", blockedPaths: info.blockedPaths });
      if (!model.report.valid || model.report.evaluation !== "complete" || model.configurationIssue || model.associationIssue) return {
        status: "manual_resolution_required", reasons: ["The target system cannot be fully validated under the supported contracts."],
      };
      const config = model.config;
      const targetVersion = String(config.version ?? "");
      if (targetVersion === input.fromVersion) return { status: "ready", reasons: [] };
      const declaredMetadata = safeMetadataDirectory(config.metadata_directory).normalize("NFC");
      const metadataDirectory = readdirSync(root, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.normalize("NFC") === declaredMetadata)?.name ?? declaredMetadata;
      const historyPath = join(root, metadataDirectory, "history.md");
      if (!existsSync(historyPath)) return {
        status: "manual_resolution_required", reasons: [`The target system has no history.md for classifying the ${input.fromVersion} to ${targetVersion} update.`],
      };
      const history = parseMarkdown(readFileSync(historyPath)).data;
      const entries = Array.isArray(history.history) ? history.history : [];
      if (!entries.some((entry) => entry.version === input.fromVersion)) return {
        status: "manual_resolution_required", reasons: ["The target system history is incomplete for this update."],
      };
      // History is necessary evidence, not target-aware impact analysis. This
      // bounded adapter cannot approve an actual migration from versions alone.
      return { status: "manual_resolution_required", reasons: ["Target-collection migration impact analysis is not implemented; review is required before applying an update."] };
    }, { artifactsOnly: true, rejectMetadataLinks: true });
  } catch {
    return { status: "manual_resolution_required", reasons: ["The target system could not be read as a stable, interpretable snapshot."] };
  }
}

function serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  // Keep all content; quoted multiline strings also preserve all-space lines
  // that the library's block-scalar serializer otherwise drops.
  return `---\n${stringify(frontmatter, { lineWidth: 0, blockQuote: false })}---\n${body}`;
}

function safeTarget(root: string, requestedPath: string): string {
  const target = resolve(root, requestedPath);
  const relativePath = relative(resolve(root), target);
  if (relativePath === ".." || relativePath.startsWith(`..\\`) || relativePath.startsWith("../") || isAbsolute(relativePath)) throw new Error(`Path escapes target root: ${requestedPath}`);
  return target;
}

function normalized(path: string): string { return path.replaceAll("\\", "/"); }

function safeMetadataDirectory(value: unknown): string {
  return typeof value === "string" && value !== "." && value !== ".." && /^[^/\\]+$/.test(value) ? value : ".typedmark";
}
