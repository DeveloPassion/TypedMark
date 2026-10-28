import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import type { CollectionModel, ManagedNote } from "./collection-model";
import { inspectBodyLinks, linkedNotePath, parseNoteLink, resolveNoteLink, type ParsedNoteLink } from "./note-links";
import { namePart, resolveStoragePath } from "./storage";
import { readCollectionModel } from "./validator";

type Data = Record<string, unknown>;

export class EditError extends Error {
  constructor(
    readonly rule_id: string,
    message: string,
  ) {
    super(`${rule_id}: ${message}`);
  }
}

interface Entry {
  key: string;
  /** Comment lines directly above the key (ER-1, ER-4). */
  comments: string[];
  lines: string[];
  /** Blank lines after the entry; they stay in place when it changes. */
  after: string[];
}
interface SplitNote {
  bom: string;
  eol: string;
  head: string[];
  entries: Entry[];
  tail: string[];
  close: string;
  body: string;
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"\-?:,[\]{}][^:#]*?)[ \t]*:(?=[ \t]|$)/u;
const unquote = (key: string) => (/^["']/u.test(key) ? Object.keys(parse(`${key}: 0`) as Data)[0]! : key);

// Split a note into its frontmatter entries and exact body, keeping every byte (ER-5).
function splitNote(text: string): SplitNote | undefined {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const rest = text.slice(bom.length);
  const opening = /^---(\r\n|\r|\n)/u.exec(rest);
  if (!opening) return undefined;
  const eol = opening[1]!;
  const lines: Array<{ text: string; end: number }> = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/gu;
  pattern.lastIndex = opening[0].length;
  let close: { text: string; end: number } | undefined;
  for (let match = pattern.exec(rest); match && match.index < rest.length; match = pattern.exec(rest)) {
    const line = { text: match[1]!, end: match.index + match[0].length };
    if (line.text === "---" || line.text === "...") {
      close = { text: rest.slice(match.index, line.end), end: line.end };
      break;
    }
    lines.push(line);
    if (match[0] === "") break;
  }
  if (!close) return undefined;
  const split: SplitNote = { bom, eol, head: [], entries: [], tail: [], close: close.text, body: rest.slice(close.end) };
  // Comment and blank lines wait until the next line shows where they belong.
  let loose: string[] = [];
  for (const { text: line } of lines) {
    const current = split.entries.at(-1);
    if (line.trim() === "" || line.startsWith("#")) {
      loose.push(line);
      continue;
    }
    const key = KEY.exec(line);
    if (key) {
      // Only the comment lines directly above a key are attached to it.
      let attached = loose.length;
      while (attached > 0 && loose[attached - 1]!.startsWith("#")) attached--;
      (current ? current.after : split.head).push(...loose.slice(0, attached));
      split.entries.push({ key: unquote(key[1]!), comments: loose.slice(attached), lines: [line], after: [] });
      loose = [];
      continue;
    }
    // A continuation: indented content or a block sequence item under the current key.
    if (!current) throw new EditError("ER-1", "Frontmatter is not a block mapping");
    current.lines.push(...current.after.splice(0), ...loose, line);
    loose = [];
  }
  split.tail.push(...loose);
  return split;
}

function joinNote(split: SplitNote): string {
  const lines = [...split.head, ...split.entries.flatMap((entry) => [...entry.comments, ...entry.lines, ...entry.after]), ...split.tail];
  return `${split.bom}---${split.eol}${lines.map((line) => line + split.eol).join("")}${split.close}${split.body}`;
}

function serialize(key: string, value: unknown): string[] {
  return stringify({ [key]: value }, { version: "1.2", lineWidth: 0 })
    .replace(/\n$/u, "")
    .split("\n");
}

/**
 * Assign (a value) or remove (undefined) top-level frontmatter keys, leaving
 * every other byte of the note as it was (ER-1 to ER-6). Added keys follow the
 * nearest present key before them in `order`, or end the frontmatter (ER-3).
 */
export function editFrontmatter(text: string, changes: Record<string, unknown>, order: string[] = []): string {
  const split = splitNote(text);
  if (!split) throw new EditError("ER-5", "The note has no frontmatter block");
  for (const [key, value] of Object.entries(changes)) {
    const index = split.entries.findIndex((entry) => entry.key === key);
    if (value === undefined) {
      if (index < 0) continue;
      const [removed] = split.entries.splice(index, 1);
      (split.entries[index - 1]?.after ?? split.head).push(...removed!.after);
      continue;
    }
    const lines = serialize(key, value);
    if (index >= 0) {
      const entry = split.entries[index]!;
      // A trailing comment on a single-line entry survives a single-line value (ER-2).
      const comment =
        entry.lines.length === 1
          ? (parseDocument(entry.lines[0]!).contents as { items?: Array<{ value?: { comment?: string } }> })?.items?.[0]?.value?.comment
          : undefined;
      entry.lines = comment && lines.length === 1 ? [`${lines[0]} #${comment}`] : lines;
      continue;
    }
    const position = order.indexOf(key);
    const anchor = position < 0 ? -1 : split.entries.findLastIndex((entry) => order.indexOf(entry.key) >= 0 && order.indexOf(entry.key) < position);
    const target = anchor >= 0 ? anchor : split.entries.length - 1;
    const added: Entry = { key, comments: [], lines, after: [] };
    if (target >= 0) {
      added.after = split.entries[target]!.after;
      split.entries[target]!.after = [];
    }
    split.entries.splice(target + 1, 0, added);
  }
  return joinNote(split);
}

export interface EditIssue {
  rule: string;
  message: string;
}
export interface EditPlan {
  /** Notes that move, old path to new path (ER-12, ER-13). */
  moves: Array<{ from: string; to: string }>;
  /** Links rewritten per written note (ER-7, ER-10). */
  rewrites: Array<{ path: string; links: number }>;
  files: Array<{ path: string; content: string }>;
  removed: string[];
  unresolved: EditIssue[];
}
export interface EditRequest {
  path: string;
  /** Keys to assign; undefined removes a key. */
  set?: Data;
  renameTo?: string;
}

const stem = (path: string) => path.replace(/\.md$/u, "");

// Replace only the target of a link's raw text (ER-8).
function withTarget(link: ParsedNoteLink, raw: string, target: string): string | undefined {
  const lead = link.embed ? 1 : 0;
  if (link.form === "wikilink") {
    const start = lead + 2;
    if (raw.slice(start, start + link.target.length) !== link.target) return undefined;
    return raw.slice(0, start) + target + raw.slice(start + link.target.length);
  }
  const start = lead + 1 + (link.displayText ?? "").length + 2;
  if (raw.slice(start - 2, start) !== "](") return undefined;
  const angle = raw[start] === "<";
  const from = start + (angle ? 1 : 0);
  // The path ends at the fragment, or at the destination's end.
  const close = angle ? raw.indexOf(">", from) : raw.slice(from).search(/[\s)]/u) + from;
  const hash = raw.indexOf("#", from);
  const end = hash >= from && hash < close ? hash : close;
  if (close < from) return undefined;
  const encoded = angle
    ? target.replace(/[<>]/gu, encodeURIComponent)
    : target
        .split("/")
        .map((segment) =>
          segment === ".." || segment === "."
            ? segment
            : encodeURIComponent(segment).replace(/[()]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
        )
        .join("/");
  return raw.slice(0, from) + encoded + raw.slice(end);
}

// Candidate targets for a link that must now reach `target`, in preference order (ER-8, ER-9).
function candidates(link: ParsedNoteLink, source: string, target: string): string[] {
  const extension = link.target.endsWith(".md") ? ".md" : "";
  const relative = () => {
    const path = posix.relative(posix.dirname(source), stem(target)) + extension;
    return path.startsWith("../") ? path : `./${path}`;
  };
  const rooted = (leading: boolean) => (leading || !stem(target).includes("/") ? "/" : "") + stem(target) + extension;
  if (link.form === "wikilink") {
    if (!link.target.includes("/")) return [posix.basename(stem(target)) + extension, rooted(false)];
    if (/^\.\.?\//u.test(link.target)) return [relative()];
    return [rooted(link.target.startsWith("/"))];
  }
  if (link.target.startsWith("/")) return [rooted(true)];
  const path = posix.relative(posix.dirname(source), stem(target)) + extension;
  return [path];
}

function resolved(link: ParsedNoteLink, source: string, model: CollectionModel): string | undefined {
  try {
    const resolution = resolveNoteLink(link, source, model);
    return resolution.kind === "note" ? resolution.path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Plan an edit, rename, or move with every re-filing and link rewrite it needs
 * (ER-7 to ER-14). Nothing is written; `files` is empty when anything is unresolved.
 */
export function planEdit(collectionRoot: string, schemaDirectory: string, request: EditRequest): EditPlan {
  const model = readCollectionModel({ collectionRoot, schemaDirectory });
  const plan: EditPlan = { moves: [], rewrites: [], files: [], removed: [], unresolved: [] };
  const unresolved = (rule: string, message: string) => plan.unresolved.push({ rule, message });
  const timezone = model.config.timezone ?? "UTC";
  const note = model.notes.find((candidate) => candidate.path === request.path);
  const document = model.documents.find((candidate) => candidate.path === request.path);
  if (!document) {
    unresolved("ER-7", `${request.path} is not a note in the collection`);
    return plan;
  }
  if (request.set && !note) unresolved("ER-12", `${request.path} is not a managed note`);
  const set = request.set ?? {};
  const valuesOf = (managed: ManagedNote): Data => {
    if (managed.path !== request.path) return managed.values;
    const values: Data = { ...managed.values };
    for (const [key, value] of Object.entries(set)) {
      if (value !== undefined) values[key] = value;
      else if (Object.hasOwn(managed.fields[key] ?? {}, "default_value")) values[key] = managed.fields[key]!.default_value;
      else delete values[key];
    }
    return values;
  };
  const moves = new Map<string, string>();
  if (request.renameTo !== undefined && request.renameTo !== request.path) moves.set(request.path, request.renameTo);
  const mapped = (path: string) => moves.get(path) ?? path;
  // A linked placeholder reads the parent's new path through its old link (ER-13).
  const refiled = (managed: ManagedNote, values: Data, current: string): string | undefined => {
    const schema = model.schemas.get(managed.noteType);
    const storage = values.archived === true && schema?.storage?.archive ? schema.storage.archive : schema?.storage;
    if (!storage) return undefined;
    const before = linkedNotePath(model, managed.path);
    const linked = (field: string, value: unknown) => {
      const target = before(field, value);
      return target === undefined ? undefined : mapped(target);
    };
    const source = namePart(storage, current, managed.values, managed.fields, timezone, linked);
    const carried = {
      prefix: !!source.prefix && storage.note_name_prefix?.optional === true,
      suffix: !!source.suffix && storage.note_name_suffix?.optional === true,
    };
    const resolution = resolveStoragePath(storage, values, managed.fields, timezone, source.name, linked, carried);
    return "failure" in resolution ? undefined : resolution.path;
  };
  // Only notes that conformed before the change follow a moved note (ER-13).
  const conformed = new Map(model.notes.map((managed) => [managed.path, refiled(managed, managed.values, managed.path) === managed.path]));
  if (note && request.renameTo === undefined && Object.keys(set).length) {
    const target = refiled(note, valuesOf(note), note.path);
    if (target !== undefined && target !== note.path) moves.set(note.path, target);
  }
  // Dependents stored through a moved note follow it, until nothing else moves (ER-13).
  for (let changed = true, rounds = 0; changed && rounds <= model.notes.length; rounds++) {
    changed = false;
    for (const managed of model.notes) {
      if (managed.path === request.path || !conformed.get(managed.path)) continue;
      const target = refiled(managed, managed.values, mapped(managed.path));
      if (target !== undefined && target !== mapped(managed.path)) {
        moves.set(managed.path, target);
        changed = true;
      }
    }
  }
  plan.moves = [...moves].map(([from, to]) => ({ from, to }));
  // Targets must be free and distinct (ER-14).
  const targets = new Map<string, string>();
  for (const candidate of model.documents) {
    const target = mapped(candidate.path).normalize("NFC");
    if (targets.has(target)) unresolved("ER-14", `${candidate.path} and ${targets.get(target)} would both be at ${target}`);
    targets.set(target, candidate.path);
  }
  // Other files, such as assets, can also occupy a target.
  const documents = new Set(model.documents.map((candidate) => candidate.path));
  for (const to of moves.values()) if (!documents.has(to) && existsSync(join(collectionRoot, to))) unresolved("ER-14", `${to} is taken`);

  const after: CollectionModel = {
    ...model,
    documents: model.documents.map((candidate) => ({ ...candidate, path: mapped(candidate.path) })),
    notes: model.notes.map((managed) => ({ ...managed, path: mapped(managed.path) })),
  };
  // Rewrite a link that must keep reaching `expected` from its note's new path (ER-7 to ER-10).
  const keep = (link: ParsedNoteLink, raw: string, source: string, expected: string): string | undefined => {
    if (resolved(link, mapped(source), after) === expected) return raw;
    for (const target of candidates(link, mapped(source), expected)) {
      const rewritten = withTarget(link, raw, target);
      const parsed = rewritten === undefined ? undefined : parseNoteLink(rewritten);
      if (parsed && resolved(parsed, mapped(source), after) === expected) return rewritten;
    }
    return undefined;
  };
  for (const candidate of model.documents) {
    const text = readFileSync(join(collectionRoot, candidate.path), "utf8");
    const split = splitNote(text);
    let rewrites = 0;
    const relink = (raw: string): string => {
      const link = parseNoteLink(raw);
      const before = link && resolved(link, candidate.path, model);
      if (!link || before === undefined) return raw;
      const kept = keep(link, raw, candidate.path, mapped(before));
      if (kept === undefined) {
        unresolved("ER-10", `${candidate.path}: ${raw} cannot keep resolving to ${mapped(before)}`);
        return raw;
      }
      if (kept !== raw) rewrites++;
      return kept;
    };
    // Frontmatter link values, as whole strings or list items.
    const changes: Data = candidate.path === request.path ? { ...set } : {};
    const stored = (model.notes.find((managed) => managed.path === candidate.path)?.stored ?? {}) as Data;
    for (const [key, value] of Object.entries(stored)) {
      if (Object.hasOwn(changes, key)) continue;
      if (typeof value === "string") {
        const next = relink(value);
        if (next !== value) changes[key] = next;
      } else if (Array.isArray(value) && value.some((item) => typeof item === "string")) {
        const next = value.map((item) => (typeof item === "string" ? relink(item) : item));
        if (next.some((item, index) => item !== value[index])) changes[key] = next;
      }
    }
    // Body links, replaced through their exact source spans from the end.
    const bodyStart = split ? text.length - split.body.length : text.startsWith("﻿") ? 1 : 0;
    const body = text.slice(bodyStart);
    let rewrittenBody = body;
    for (const link of inspectBodyLinks(body).links.reverse()) {
      const next = relink(link.source.raw);
      if (next !== link.source.raw) rewrittenBody = rewrittenBody.slice(0, link.source.start) + next + rewrittenBody.slice(link.source.end);
    }
    let content = text;
    if (Object.keys(changes).length) {
      const order = Object.keys(
        note && candidate.path === request.path ? note.fields : (model.notes.find((managed) => managed.path === candidate.path)?.fields ?? {}),
      );
      content = editFrontmatter(text, changes, order);
    }
    if (rewrittenBody !== body) content = content.slice(0, content.length - body.length) + rewrittenBody;
    const target = mapped(candidate.path);
    if (content !== text || target !== candidate.path) plan.files.push({ path: target, content });
    if (target !== candidate.path) plan.removed.push(candidate.path);
    if (rewrites) plan.rewrites.push({ path: target, links: rewrites });
  }
  if (plan.unresolved.length) plan.files = [];
  return plan;
}

/** Write a plan with nothing unresolved: every file is staged first, then renamed into place (ER-14). */
export function applyEdit(collectionRoot: string, plan: EditPlan): void {
  if (plan.unresolved.length) throw new EditError("ER-14", "The edit plan has unresolved issues");
  const staged = plan.files.map((file) => {
    const target = join(collectionRoot, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.typedmark-edit`, file.content);
    return target;
  });
  for (const target of staged) renameSync(`${target}.typedmark-edit`, target);
  const written = new Set(plan.files.map((file) => file.path));
  for (const path of plan.removed) {
    if (written.has(path)) continue;
    rmSync(join(collectionRoot, path));
    // Folders a move emptied go too, up to the collection root.
    for (let folder = dirname(path); folder !== "." && !readdirSync(join(collectionRoot, folder)).length; folder = dirname(folder))
      rmSync(join(collectionRoot, folder), { recursive: true });
  }
}
