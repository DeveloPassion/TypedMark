import { posix } from "node:path";
import { Lexer, Marked, Tokenizer, type TokenizerExtension } from "marked";
import type { CollectionModel, ManagedNote } from "./collection-model";
import type { FieldDefinition } from "./field-values";
import type { SchemaIssue } from "./reuse";

export interface ParsedNoteLink {
  /** Exact input supplied to parseNoteLink, not rendered Markdown. */
  raw: string;
  form: "wikilink" | "markdown";
  target: string;
  /** Authored fragment spelling; anchor interpretation is separate. */
  anchor?: string;
  /** Authored label content, including any inline Markdown or escapes. */
  displayText?: string;
  embed: boolean;
}
export class NoteLinkError extends Error {
  field?: string;
  constructor(readonly rule_id: string, message: string, readonly schemaIssue?: SchemaIssue) { super(`${rule_id}: ${message}`); }
}
export function parseNoteLink(raw: string): ParsedNoteLink | undefined {
  const wiki = /^(!?)\[\[([^\]\r\n]+)\]\](?![\s\S])/u.exec(raw);
  if (wiki) {
    const inner = wiki[2]!, pipe = inner.indexOf("|");
    const destination = pipe < 0 ? inner : inner.slice(0, pipe);
    const hash = destination.indexOf("#");
    return { raw, form: "wikilink", target: hash < 0 ? destination : destination.slice(0, hash), embed: wiki[1] === "!",
      ...(hash < 0 ? {} : { anchor: destination.slice(hash + 1) }),
      ...(pipe < 0 ? {} : { displayText: inner.slice(pipe + 1) }) };
  }
  const tokens = Lexer.lexInline(raw, { gfm: false });
  if (tokens.length !== 1 || !["link", "image"].includes(tokens[0]!.type) || tokens[0]!.raw !== raw) return undefined;
  const token = tokens[0] as { type: string; href: string };
  if (/^[a-z][a-z0-9+.-]*:/iu.test(token.href)) return undefined;
  // Marked's text/href remove some escapes. Preserve lexical components from
  // the same pinned grammar only after its tokenizer accepts the entire input.
  // https://github.com/markedjs/marked/blob/v18.0.5/src/Tokenizer.ts
  const source = Lexer.rules.inline.normal.link.exec(raw);
  if (!source || source[0] !== raw || source[1] === undefined || source[2] === undefined) {
    throw new Error("Marked's accepted link no longer matches its source-capture contract");
  }
  const destination = source[2].trim();
  const authored = destination.startsWith("<") ? destination.slice(1, -1) : destination;
  const hash = authored.indexOf("#");
  try { return { raw, form: "markdown", target: decodeURIComponent(token.href.split("#")[0]!), embed: token.type === "image",
    displayText: source[1], ...(hash < 0 ? {} : { anchor: authored.slice(hash + 1) }) }; }
  catch { return undefined; }
}

const wikilinks: TokenizerExtension = {
  name: "typedmarkWikilink", level: "inline",
  start(source) { const index = source.indexOf("[["); return index < 0 ? undefined : Math.max(0, index - 1); },
  tokenizer(source) {
    const match = /^!?\[\[[^\]\r\n]+\]\]/u.exec(source);
    return match ? { type: "typedmarkWikilink", raw: match[0] } : undefined;
  },
};
const markdown = new Marked({ gfm: false });
markdown.use({ extensions: [wikilinks] });

// Inspect HTML-contained prose without replacing source characters or letting
// HTML tags hide its links. Custom inline tokens run before the built-in tag rule.
// https://marked.js.org/using_pro#extensions
const htmlContent = new Marked({ gfm: false });
htmlContent.use({ extensions: [{ ...wikilinks,
  // One earliest-marker scan avoids searching the whole suffix for a distant
  // wikilink at every literal HTML delimiter (and vice versa).
  start(source) {
    const index = source.search(/\[\[|</u);
    return index < 0 ? undefined : source[index] === "<" ? index : Math.max(0, index - 1);
  },
}, {
  name: "typedmarkLiteralHtmlOpen", level: "inline",
  tokenizer(source) {
    if (!source.startsWith("<")) return;
    // This lexer only extracts links. Consume literal HTML prose in one chunk,
    // stopping before link/embed starts, escapes or code spans, rather than
    // making every tag delimiter re-enter Marked's full inline-rule pipeline.
    const boundary = source.search(/[\\`\[]|!\[/u);
    return { type: "typedmarkLiteralHtmlOpen", raw: boundary < 0 ? source : source.slice(0, boundary) };
  },
}] });

export function extractBodyLinks(body: string): ParsedNoteLink[] {
  return extractLinks(body, markdown);
}

function extractLinks(body: string, parser: Marked): ParsedNoteLink[] {
  const links: ParsedNoteLink[] = [];
  const tokenizer = parser === htmlContent ? new Tokenizer(parser.defaults) : undefined;
  const lexer = new Lexer({ ...parser.defaults, ...(tokenizer ? { tokenizer } : {}) });
  if (tokenizer) {
    tokenizer.html = () => undefined;
    // Marked masks every HTML tag by repeatedly rebuilding the entire inline
    // string. This extraction-only lexer treats HTML as literal prose, so skip
    // that mask while retaining its link/code masks. Never mutate shared rules.
    // https://github.com/markedjs/marked/blob/v18.0.5/src/Lexer.ts
    // https://github.com/markedjs/marked/blob/v18.0.5/src/rules.ts
    const rules = tokenizer.rules;
    const htmlMask = "|<(?! )[^<>]*?>";
    if (!rules.inline.blockSkip.source.endsWith(htmlMask)) throw new Error("Marked's HTML masking contract changed");
    tokenizer.rules = { ...rules, inline: { ...rules.inline,
      blockSkip: new RegExp(rules.inline.blockSkip.source.slice(0, -htmlMask.length), rules.inline.blockSkip.flags),
    } };
  }
  parser.walkTokens(lexer.lex(body), (token) => {
    if (["typedmarkWikilink", "link", "image"].includes(token.type)) {
      const link = parseNoteLink(token.raw);
      if (link) links.push(link);
    } else if (token.type === "html" && token.raw.includes("<")) {
      const prose = token.raw.split("\n").filter((line) => !/^ {0,3}<!-- (?:typedmark:(?:expansion|template-region) \{.*\}|\/typedmark:(?:expansion|template-region)) -->(?![\s\S])/u.test(line)).join("\n");
      links.push(...extractLinks(prose, htmlContent));
    }
  });
  return links;
}

type Resolution = { kind: "note" | "asset"; path: string } | { kind: "unresolved" };
export function resolveNoteLink(link: Pick<ParsedNoteLink, "form" | "target" | "embed">, source: string, model: CollectionModel, targets?: (note: ManagedNote) => boolean): Resolution {
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
    const visit = (definition: FieldDefinition, value: unknown, stored: unknown, present: boolean, field: string, kind?: "belongs_to" | "related_to"): void => {
      if (value == null) return;
      if (definition.type === "list") {
        if (!Array.isArray(value) || !definition.items) return;
        const storedItems = present && Array.isArray(stored) ? stored : undefined;
        value.forEach((entry, index) => {
          const itemPresent = storedItems !== undefined && Object.hasOwn(storedItems, index);
          visit(definition.items!, entry, itemPresent ? storedItems[index] : undefined, itemPresent, field, kind);
        });
        return;
      }
      if (definition.type === "object") {
        if (typeof value !== "object" || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return;
        const effective = value as Record<string, unknown>;
        const physical = present && stored !== null && typeof stored === "object" && !Array.isArray(stored)
          ? stored as Record<string, unknown> : undefined;
        for (const [name, child] of Object.entries(definition.fields ?? {})) {
          const childPresent = physical !== undefined && Object.hasOwn(physical, name);
          // FDR-151/160 depend on stored leaves, not a stored parent or defaults.
          // Nested fields never inherit a top-level relationship contribution.
          visit(child, Object.hasOwn(effective, name) ? effective[name] : undefined,
            childPresent ? physical[name] : undefined, childPresent, `${field}.${name}`);
        }
        return;
      }
      if (definition.type !== "link" || definition.format !== "note_link") return;
      attempt(() => {
        const parsed = typeof value === "string" ? parseNoteLink(value) : undefined;
        if (!parsed || parsed.embed) throw new NoteLinkError("NL-7", "A note-link field stores one non-embed internal link");
        record(parsed, kind, present ? definition.targets : undefined, present && definition.validate_exists, true);
      }, field);
    };
    for (const [name, definition] of Object.entries(note.fields)) {
      const present = Object.hasOwn(note.stored, name);
      visit(definition, Object.hasOwn(note.values, name) ? note.values[name] : undefined,
        present ? note.stored[name] : undefined, present, name, definition.relationship_kind);
    }
    for (const link of extractBodyLinks(note.body)) attempt(() => record(link, "related_to"));
  }
  return graph;
}
