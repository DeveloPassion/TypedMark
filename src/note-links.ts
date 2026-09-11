import { posix } from "node:path";
import { Lexer, Marked } from "marked";
import type { CollectionModel, ManagedNote } from "./collection-model";
import type { SchemaIssue } from "./reuse";

export interface ParsedNoteLink { form: "wikilink" | "markdown"; target: string; embed: boolean }
export class NoteLinkError extends Error {
  field?: string;
  constructor(readonly rule_id: string, message: string, readonly schemaIssue?: SchemaIssue) { super(`${rule_id}: ${message}`); }
}
export function parseNoteLink(raw: string): ParsedNoteLink | undefined {
  const wiki = /^(!?)\[\[([^\]\r\n]+)\]\](?![\s\S])/u.exec(raw);
  if (wiki) return { form: "wikilink", target: wiki[2]!.split("|")[0]!.split("#")[0]!, embed: wiki[1] === "!" };
  const tokens = Lexer.lexInline(raw, { gfm: false });
  if (tokens.length !== 1 || !["link", "image"].includes(tokens[0]!.type) || tokens[0]!.raw !== raw) return undefined;
  const token = tokens[0] as { type: string; href: string };
  if (/^[a-z][a-z0-9+.-]*:/iu.test(token.href)) return undefined;
  try { return { form: "markdown", target: decodeURIComponent(token.href.split("#")[0]!), embed: token.type === "image" }; }
  catch { return undefined; }
}

const markdown = new Marked({ gfm: false });
markdown.use({ extensions: [{
  name: "typedmarkWikilink", level: "inline",
  start(source) { const index = source.indexOf("[["); return index < 0 ? undefined : Math.max(0, index - 1); },
  tokenizer(source) {
    const match = /^!?\[\[[^\]\r\n]+\]\]/u.exec(source);
    return match ? { type: "typedmarkWikilink", raw: match[0] } : undefined;
  },
}] });

export function extractBodyLinks(body: string): ParsedNoteLink[] {
  const links: ParsedNoteLink[] = [];
  markdown.walkTokens(markdown.lexer(body), (token) => {
    if (["typedmarkWikilink", "link", "image"].includes(token.type)) {
      const link = parseNoteLink(token.raw);
      if (link) links.push(link);
    } else if (token.type === "html" && token.raw.includes("<")) {
      const prose = token.raw.split("\n").filter((line) => !/^ {0,3}<!-- (?:typedmark:(?:expansion|template-region) \{.*\}|\/typedmark:(?:expansion|template-region)) -->(?![\s\S])/u.test(line)).join("\n");
      links.push(...extractBodyLinks(prose.replaceAll("<", "&lt;")));
    }
  });
  return links;
}

type Resolution = { kind: "note" | "asset"; path: string } | { kind: "unresolved" };
export function resolveNoteLink(link: ParsedNoteLink, source: string, model: CollectionModel, targets?: (note: ManagedNote) => boolean): Resolution {
  const target = link.target.normalize("NFC");
  const named = link.form === "wikilink" && !target.includes("/");
  if (!named) {
    const rootRelative = target.startsWith("/") || (link.form === "wikilink" && !target.startsWith("./") && !target.startsWith("../"));
    const path = posix.normalize(rootRelative ? target.replace(/^\//, "") : posix.join(posix.dirname(source), target));
    if (path === ".." || path.startsWith("../") || path.startsWith("/")) throw new NoteLinkError("NL-16", "Link escapes the selected collection root");
    if (!path.endsWith(".md") && model.assets.has(path)) return { kind: "asset", path };
    const notePath = path.endsWith(".md") ? path : `${path}.md`;
    return model.documents.some((note) => note.path === notePath) ? { kind: "note", path: notePath } : { kind: "unresolved" };
  }
  const managed = model.notes.filter((note) => !targets || targets(note));
  const ids = managed.filter((note) => typeof note.stored.id === "string" && note.stored.id.normalize("NFC") === target);
  if (ids.length > 1) throw new NoteLinkError("NL-19", "Ambiguous note id");
  if (ids.length === 1) return { kind: "note", path: ids[0]!.path };
  const choose = (paths: string[], kind: "note" | "asset"): Resolution | undefined => {
    if (!paths.length) return undefined;
    const local = paths.filter((path) => posix.dirname(path) === posix.dirname(source));
    const candidates = local.length ? local : paths;
    const depth = Math.min(...candidates.map((path) => path.split("/").length));
    const closest = candidates.filter((path) => path.split("/").length === depth);
    if (closest.length !== 1) throw new NoteLinkError("NL-19", "Ambiguous note or asset name");
    return { kind, path: closest[0]! };
  };
  const documents = targets ? managed : model.documents;
  const names = documents.filter((note) => posix.basename(note.path, ".md") === target).map((note) => note.path);
  const byName = choose(names, "note");
  if (byName) return byName;
  const aliases = managed.filter((note) => Array.isArray(note.stored.aliases) && note.stored.aliases.some((alias: unknown) => typeof alias === "string" && alias.normalize("NFC") === target));
  return choose(aliases.map((note) => note.path), "note")
    ?? (target.includes(".") ? choose([...model.assets].filter((path) => posix.basename(path) === target), "asset") : undefined)
    ?? { kind: "unresolved" };
}

export interface RelationshipGraph {
  targets: Map<string, Record<"belongs_to" | "related_to", Set<string>>>;
  failures: Map<string, NoteLinkError[]>;
}
export function buildRelationshipGraph(model: CollectionModel, matchesType: (actual: string, requested: string) => boolean): RelationshipGraph {
  const graph: RelationshipGraph = { targets: new Map(), failures: new Map() };
  const managed = new Map(model.notes.map((note) => [note.path, note]));
  for (const note of model.notes) {
    const edges = { belongs_to: new Set<string>(), related_to: new Set<string>() };
    graph.targets.set(note.path, edges);
    const issue = model.schemaIssues?.get(note.noteType);
    if (issue) { graph.failures.set(note.path, [new NoteLinkError("CM-308", issue.message, issue)]); continue; }
    const schema = model.schemas.get(note.noteType)!;
    const record = (link: ParsedNoteLink, kind?: "belongs_to" | "related_to", targets?: string[], validateExists = false, field = false) => {
      const allowed = targets ? (candidate: ManagedNote) => targets.some((type) => matchesType(candidate.noteType, type)) : undefined;
      const resolved = resolveNoteLink(link, note.path, model, allowed);
      if (resolved.kind === "unresolved") {
        if (validateExists) throw new NoteLinkError("FDR-153", "Required note link does not resolve");
        return;
      }
      if (resolved.kind === "asset") {
        if (field) throw new NoteLinkError("NL-33", "A note-link field cannot target an asset");
        return;
      }
      const target = managed.get(resolved.path);
      const targetIssue = target && model.schemaIssues?.get(target.noteType);
      if (targetIssue) throw new NoteLinkError("CM-308", targetIssue.message, targetIssue);
      if (allowed && (!target || !allowed(target))) throw new NoteLinkError("FDR-160", "Link target does not satisfy its field targets");
      if (!target || !kind || target.values.deleted === true) return;
      const declarations = Object.keys(schema.relationships?.[kind]?.allowed_note_types ?? {});
      if (declarations.some((type) => matchesType(target.noteType, type))) edges[kind].add(target.path);
    };
    const attempt = (action: () => void, field?: string) => {
      try { action(); } catch (error) {
        if (!(error instanceof NoteLinkError)) throw error;
        error.field = field;
        const failures = graph.failures.get(note.path) ?? [];
        failures.push(error); graph.failures.set(note.path, failures);
      }
    };
    for (const [name, definition] of Object.entries(note.fields)) {
      const item = definition.type === "list" ? definition.items : definition;
      if (item?.type !== "link" || item.format !== "note_link") continue;
      const value = note.values[name];
      for (const entry of Array.isArray(value) ? value : value == null ? [] : [value]) attempt(() => {
        const parsed = typeof entry === "string" ? parseNoteLink(entry) : undefined;
        if (!parsed || parsed.embed) throw new NoteLinkError("NL-7", "A note-link field stores one non-embed internal link");
        const stored = Object.hasOwn(note.stored, name);
        record(parsed, definition.relationship_kind, stored ? item.targets : undefined, stored && item.validate_exists, true);
      }, name);
    }
    for (const link of extractBodyLinks(note.body)) attempt(() => record(link, "related_to"));
  }
  return graph;
}
