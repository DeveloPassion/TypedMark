import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { parseMarkdown } from "./frontmatter";
import { exclusionPatterns, isExcluded, isSubtreeExcluded } from "./paths";

export class SnapshotChangedError extends Error {}
export interface SnapshotInfo { blockedPaths: ReadonlySet<string> }
interface SnapshotOptions {
  includePaths?: readonly string[];
  rejectMetadataLinks?: boolean;
  /** Capture configuration, metadata and explicit inclusions, not current notes/assets. */
  artifactsOnly?: boolean;
}
interface Capture { files: Map<string, Buffer>; blockedPaths: Set<string>; includedDirectories: Set<string> }

export function readStableCollection<T>(root: string, read: (snapshotRoot: string, info: SnapshotInfo) => T, options: SnapshotOptions = {}): T {
  const captured = capture(root, options);
  const before = fingerprint(captured);
  const snapshotRoot = mkdtempSync(join(tmpdir(), "typedmark-query-snapshot-"));
  try {
    for (const directory of captured.includedDirectories) mkdirSync(join(snapshotRoot, directory), { recursive: true });
    for (const [path, content] of captured.files) {
      const destination = join(snapshotRoot, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    }
    const result = read(snapshotRoot, { blockedPaths: captured.blockedPaths });
    if (fingerprint(capture(root, options)) !== before) throw new SnapshotChangedError("The collection changed while its snapshot was being read");
    return result;
  } finally { rmSync(snapshotRoot, { recursive: true, force: true }); }
}

function capture(root: string, options: SnapshotOptions): Capture {
  if (lstatSync(root).isSymbolicLink()) throw new SnapshotChangedError("A query collection root cannot be a symbolic link or junction");
  const files = new Map<string, Buffer>();
  const blockedPaths = new Set<string>();
  const includedDirectories = new Set<string>();
  let config: Record<string, unknown> = {};
  const configuration = join(root, "typedmark.md");
  if (existsSync(configuration) && !lstatSync(configuration).isSymbolicLink()) {
    const content = readFileSync(configuration);
    files.set("typedmark.md", content);
    try { config = parseMarkdown(content).data; } catch { /* The validator reports malformed configuration. */ }
  }
  const excludes = exclusionPatterns(config.exclude_paths);
  const metadata = (typeof config.metadata_directory === "string" ? config.metadata_directory : ".typedmark").normalize("NFC");
  const selections = (options.includePaths ?? []).map((path) => path.normalize("NFC"));
  const visit = (directory: string, prefix = "", onlyGoverned = options.artifactsOnly === true) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      const absolute = join(directory, entry.name);
      const logicalPath = path.normalize("NFC");
      const included = selections.some((selected) => logicalPath === selected || logicalPath.startsWith(`${selected}/`));
      const leadsToSelection = selections.some((selected) => selected.startsWith(`${logicalPath}/`));
      const governed = logicalPath === "typedmark.md" || logicalPath === metadata || logicalPath.startsWith(`${metadata}/`)
        || included;
      if (onlyGoverned && !governed && !leadsToSelection) continue;
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
        if (governed || leadsToSelection) {
          if (options.rejectMetadataLinks) throw new SnapshotChangedError(`System import refuses symbolic link: ${path}`);
          blockedPaths.add(logicalPath);
        }
        continue;
      }
      const neededAncestor = entry.isDirectory() && leadsToSelection;
      if (onlyGoverned && !governed && !neededAncestor) continue;
      if (!governed && !neededAncestor && (entry.isDirectory() ? isSubtreeExcluded(path, excludes) : isExcluded(path, excludes))) continue;
      if (entry.isDirectory()) {
        const nested = !governed && existsSync(join(absolute, "typedmark.md"));
        if (nested && !neededAncestor) continue;
        if (included || (onlyGoverned && governed)) includedDirectories.add(path);
        // Crossing a nested collection for one explicit file does not admit siblings.
        visit(absolute, `${path}/`, onlyGoverned || nested);
      } else if (entry.isFile() && !files.has(path)) files.set(path, readFileSync(absolute));
    }
  };
  visit(root);
  return { files, blockedPaths, includedDirectories };
}

function fingerprint(captured: Capture): string {
  return JSON.stringify({ files: [...captured.files].map(([path, content]) => [path, createHash("sha256").update(content).digest("hex")])
    .sort(([left], [right]) => left! < right! ? -1 : left! > right! ? 1 : 0), blockedPaths: [...captured.blockedPaths].sort(), includedDirectories: [...captured.includedDirectories].sort() });
}
