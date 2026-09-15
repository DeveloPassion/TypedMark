import { Alias, Document, isAlias, isCollection, isMap, isNode, isPair, isScalar, isSeq, Pair, stringify, visit, YAMLMap, type Node, type Scalar } from "yaml";

/** Rewrite publishing identity without converting opaque YAML values through JS. */
export function instantiateConfiguration(source: Document, input: { name: string; description?: string; source: { name: string; version: string } }): string {
  // Work on an isolated tree. The source graph is still needed if metadata
  // refers to a removed field, an overwritten scalar, or the source root itself.
  // https://eemeli.org/yaml/#documents
  const original = source.clone();
  if (!isMap(original.contents)) throw new Error("System configuration must be a mapping");
  preserveScalarSources(original);
  const aliases = resolveAliases(original);
  const output = new Document(undefined, { schema: original.schema });
  const root = new YAMLMap(output.schema);
  root.tag = original.contents.tag;
  const changes = new Map<string, unknown>([["name", input.name], ["composition", { sources: [input.source] }]]);
  if (input.description !== undefined) changes.set("description", input.description);
  for (const [name, pair] of rootEntries(original.contents, aliases)) {
    if (name === "version" || name === "scaffold") continue;
    root.items.push(new Pair(pair.key, changes.has(name) ? output.createNode(changes.get(name)) : pair.value));
    changes.delete(name);
  }
  for (const [key, value] of changes) root.items.push(output.createPair(key, value));

  // Visit the resulting graph in output order. Emit each value once, then use
  // fresh aliases, so moving/removing an anchor cannot strand its references.
  // Pairs are edges, not identity-bearing nodes: never share mutable pairs
  // between the new root and the source root retained inside vendor metadata.
  const emitted = new Set<Node>();
  let nextAnchor = 0;
  function emit(value: unknown): unknown {
    if (isAlias(value)) value = aliases.get(value);
    if (isPair(value)) return new Pair(emit(value.key), emit(value.value));
    if (!isNode(value) || isAlias(value)) return value;
    if (emitted.has(value)) return new Alias(value.anchor ??= `a${++nextAnchor}`);
    emitted.add(value);
    delete value.anchor;
    if (isCollection(value)) value.items = value.items.map(emit) as typeof value.items;
    return value;
  }
  output.contents = emit(root) as YAMLMap;
  // Default tag directives expand custom handles to their full URI. Suppress
  // stream markers, which would otherwise close Markdown frontmatter early.
  // Quoted multiline strings avoid coupling their values to the closing
  // Markdown delimiter's line break. Never trim the serialized YAML.
  // https://eemeli.org/yaml/#stream-directives
  return output.toString({ directives: false, lineWidth: 0, blockQuote: false });
}

function preserveScalarSources(document: Document): void {
  const sources = new Map<Scalar, string>();
  visit(document, { Scalar(_key, node) {
    if (typeof node.source !== "string" || !(typeof node.value === "number" || node.value instanceof Date)) return;
    // Number/Date are bounded projections, not lossless YAML scalar storage.
    // Retain the parsed scalar text under its original tag instead of rounding
    // large integers, overflowing floats or truncating timestamp fractions.
    node.tag ??= document.schema.tags.find((tag) => tag.default && tag.test?.test(node.source!))?.tag;
    if (!node.tag) throw new Error("Parsed numeric scalar has no YAML tag");
    sources.set(node, stringify(node.source, { defaultStringType: "QUOTE_DOUBLE", lineWidth: 0 }).trimEnd());
  } });
  // Change the cloned schema only. New identity/provenance nodes have no source
  // entry and continue through the library's normal serializers.
  // https://eemeli.org/yaml/#custom-data-types
  document.schema.tags = document.schema.tags.map((tag) => typeof tag.stringify !== "function" ? tag : {
    ...tag, stringify: (node, ...args) => isScalar(node) && sources.has(node) ? sources.get(node)! : tag.stringify!(node, ...args),
  });
}

/** Expand only root merge entries; opaque nested mappings keep their own graph. */
function rootEntries(root: YAMLMap, aliases: Map<Alias, Node>): Map<string, Pair> {
  const entries = new Map<string, Pair>();
  const resolve = (node: unknown) => isAlias(node) ? aliases.get(node) : node;
  for (const pair of root.items) {
    if (isScalar(pair.key) && pair.key.tag === "tag:yaml.org,2002:merge") {
      const source = resolve(pair.value);
      for (const item of isSeq(source) ? source.items : [source]) {
        const mapping = resolve(item);
        if (!isMap(mapping)) throw new Error("YAML merge source must be a mapping");
        // Earlier merge sources win; an explicit field overrides inherited ones.
        // https://yaml.org/type/merge.html
        for (const [name, entry] of rootEntries(mapping, aliases)) if (!entries.has(name)) entries.set(name, entry);
      }
    } else {
      const key = resolve(pair.key);
      if (!isScalar(key) || typeof key.value !== "string") throw new Error("System configuration keys must be strings");
      entries.set(key.value, pair);
    }
  }
  return entries;
}

function resolveAliases(document: Document): Map<Alias, Node> {
  const anchors = new Map<string, Node>();
  const aliases = new Map<Alias, Node>();
  // YAML permits repeated anchor names; bind each alias to the most recent
  // preceding node, before any node or field is moved by the rewrite.
  // https://eemeli.org/yaml/#alias-nodes
  visit(document, { Node(_key, node) {
    if (isAlias(node)) {
      const target = anchors.get(node.source);
      if (!target) throw new Error(`Unresolved YAML alias: ${node.source}`);
      aliases.set(node, target);
    } else if (node.anchor) anchors.set(node.anchor, node);
  } });
  return aliases;
}
