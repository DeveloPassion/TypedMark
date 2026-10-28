import type { CollectionModel } from "./collection-model";
import { parseNoteLink, resolveNoteLink } from "./note-links";
import { compareUnicodeCodePoints } from "./order";
import type { Descriptor, QueryEvaluation } from "./query-engine";

export interface TreeRow {
  path: string;
  /** Resolved parent note paths, inside or outside the result. */
  parents: string[];
}
export interface TreeNode {
  path: string;
  context: boolean;
  children: TreeNode[];
}
export interface TreeOptions {
  context?: "none" | "ancestors";
  /** Resolved parents of a note outside the result, or undefined when it is not a non-deleted managed note (CM-591). */
  contextParents?: (path: string) => string[] | undefined;
}
export type TreeMove = { kind: "set_field"; field: string; value: string } | { kind: "unset_field"; field: string };

export class TreeMoveError extends Error {
  constructor(
    readonly rule_id: string,
    message: string,
  ) {
    super(`${rule_id}: ${message}`);
  }
}

/** Arrange result rows, in portable-query order, under their parents (CM-584 to CM-592). */
export function arrangeTree(rows: TreeRow[], options: TreeOptions = {}): TreeNode[] {
  const position = new Map(rows.map((row, index) => [row.path, index]));
  const context = new Set<string>();
  const parents = new Map<string, string[]>();
  // Parents in the result, plus context ancestors read through the same field (CM-584, CM-591).
  const pending: TreeRow[] = [...rows];
  while (pending.length) {
    const { path, parents: targets } = pending.shift()!;
    const own: string[] = [];
    for (const target of new Set(targets)) {
      if (target === path) continue;
      if (!position.has(target)) {
        if (options.context !== "ancestors") continue;
        if (!context.has(target)) {
          const above = options.contextParents?.(target);
          if (above === undefined) continue;
          context.add(target);
          pending.push({ path: target, parents: above });
        }
      }
      own.push(target);
    }
    parents.set(path, own);
  }
  const children = new Map<string, string[]>();
  for (const [child, above] of parents) for (const parent of above) children.set(parent, [...(children.get(parent) ?? []), child]);
  // A context row sorts at its earliest result-row descendant, before a result row there, then by path (CM-592).
  const key = (path: string): number => {
    if (position.has(path)) return position.get(path)!;
    let earliest = Infinity;
    const seen = new Set([path]);
    const queue = [...(children.get(path) ?? [])];
    while (queue.length) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      if (position.has(next)) earliest = Math.min(earliest, position.get(next)!);
      queue.push(...(children.get(next) ?? []));
    }
    return earliest;
  };
  const order = (left: string, right: string) =>
    key(left) - key(right) || Number(position.has(left)) - Number(position.has(right)) || compareUnicodeCodePoints(left, right);
  const placed = new Set<string>();
  // Every parent gets an occurrence; a row never repeats on its own path (CM-587, CM-588).
  const expand = (path: string, trail: Set<string>): TreeNode => {
    placed.add(path);
    const below = (children.get(path) ?? []).filter((child) => !trail.has(child)).sort(order);
    return { path, context: context.has(path), children: below.map((child) => expand(child, new Set([...trail, child]))) };
  };
  const forest = [...parents.keys()]
    .filter((path) => parents.get(path)!.length === 0)
    .sort(order)
    .map((root) => expand(root, new Set([root])));
  // Rows only reachable through a cycle start further roots, in query order (CM-589).
  for (const row of rows) if (!placed.has(row.path)) forest.push(expand(row.path, new Set([row.path])));
  return forest;
}

/** Arrange a tree view's evaluated rows, resolving its parent column as note links. */
export function viewTree(
  model: CollectionModel,
  query: Descriptor,
  evaluation: QueryEvaluation,
  tree: { parent: string; context?: "none" | "ancestors" },
): TreeNode[] {
  const notes = new Map(model.notes.map((note) => [note.path, note]));
  const column = query.select.find((candidate) => candidate.as === tree.parent);
  const field = column?.kind === "field" ? column.field : undefined;
  const resolved = (source: string, value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).flatMap((item) => {
      const link = typeof item === "string" ? parseNoteLink(item) : undefined;
      if (!link) return [];
      try {
        const resolution = resolveNoteLink(link, source, model);
        return resolution.kind === "note" && notes.has(resolution.path) ? [resolution.path] : [];
      } catch {
        return [];
      }
    });
  const read = (values: Record<string, unknown>, path: string) =>
    path.split(".").reduce<unknown>((value, name) => (value && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined), values);
  const rows = evaluation.paths.map((path, index) => ({ path, parents: resolved(path, evaluation.result.rows[index]![tree.parent]) }));
  return arrangeTree(rows, {
    context: tree.context,
    contextParents: (path) => {
      const note = notes.get(path);
      if (!note || note.values.deleted === true) return undefined;
      return field ? resolved(path, read(note.values, field)) : [];
    },
  });
}

/** The write that moves a row under another row, or to the root when parent is null (CM-594, CM-595). */
export function treeMove(
  forest: TreeNode[],
  field: string,
  moved: string,
  parent: string | null,
  link: (path: string) => string = (path) => `[[${path.replace(/\.md$/, "")}]]`,
): TreeMove {
  const occurrences: TreeNode[] = [];
  const visit = (node: TreeNode) => {
    if (node.path === moved) occurrences.push(node);
    node.children.forEach(visit);
  };
  forest.forEach(visit);
  if (!occurrences.length) throw new TreeMoveError("CM-595", `${moved} is not in the tree`);
  if (occurrences.some((node) => node.context)) throw new TreeMoveError("CM-595", "A context row cannot be moved");
  if (parent === null) return { kind: "unset_field", field };
  const below = (node: TreeNode): boolean => node.path === parent || node.children.some(below);
  if (occurrences.some(below)) throw new TreeMoveError("CM-595", "A row cannot move under itself or its descendants");
  return { kind: "set_field", field, value: link(parent) };
}
