import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { parseMarkdown } from "./frontmatter";
import { exclusionPatterns, isExcluded, isSubtreeExcluded } from "./paths";

export class SnapshotChangedError extends Error {}
export interface SnapshotInfo { blockedPaths: ReadonlySet<string> }
interface SnapshotOptions { includePaths?: readonly string[]; rejectMetadataLinks?: boolean }
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
  const visit = (directory: string, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      const absolute = join(directory, entry.name);
      const logicalPath = path.normalize("NFC");
      const included = options.includePaths?.some((selected) => logicalPath === selected.normalize("NFC") || logicalPath.startsWith(`${selected.normalize("NFC")}/`));
      const governed = logicalPath === "typedmark.md" || logicalPath === metadata || logicalPath.startsWith(`${metadata}/`)
        || included;
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
        if (governed) {
          if (options.rejectMetadataLinks) throw new SnapshotChangedError(`System import refuses symbolic link: ${path}`);
          blockedPaths.add(logicalPath);
        }
        continue;
      }
      if (!governed && (entry.isDirectory() ? isSubtreeExcluded(path, excludes) : isExcluded(path, excludes))) continue;
      if (entry.isDirectory()) {
        if (!governed && existsSync(join(absolute, "typedmark.md"))) continue;
        if (included) includedDirectories.add(path);
        visit(absolute, `${path}/`);
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
