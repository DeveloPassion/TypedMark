import { Alias, Document, isAlias, isCollection, isMap, isNode, isPair, isScalar, isSeq, Pair, Scalar, stringify, visit, YAMLMap, YAMLSeq, type Node } from "yaml";

interface Source { document: Document; aliases: Map<Alias, Node>; nodes: Set<unknown> }
interface Entry { key: unknown; value: YamlValue }

/** Writer-only YAML values. Semantic consumers continue to use plain JS data. */
export class YamlValue {
  private cachedEntries?: Map<string, Entry>;
  private constructor(private node: unknown, private sources: ReadonlySet<Source>, private identity: unknown = node) {}

  static from(document: Document): YamlValue {
    const anchors = new Map<string, Node>(), aliases = new Map<Alias, Node>();
    const nodes = new Set<unknown>();
    // Bind before selecting/moving nodes: YAML permits reused anchor names.
    // https://eemeli.org/yaml/#alias-nodes
    visit(document, { Node(_key, node) {
      nodes.add(node);
      if (isAlias(node)) {
        const target = anchors.get(node.source);
        if (!target) throw new Error(`Unresolved YAML alias: ${node.source}`);
        aliases.set(node, target);
      } else if (node.anchor) anchors.set(node.anchor, node);
    }, Pair(_key, pair) { nodes.add(pair); } });
    return new YamlValue(document.contents, new Set([{ document, aliases, nodes }]));
  }

  static literal(value: unknown): YamlValue {
    const document = new Document(undefined, { schema: "core", customTags: ["binary", "omap", "set", "timestamp"] });
    // Timestamp is implicit in YAML 1.1, but our output is read as Core 1.2.
    document.schema.tags = document.schema.tags.map(tag => tag.tag === "tag:yaml.org,2002:timestamp" ? { ...tag, default: false } : tag);
    document.contents = document.createNode(value);
    return YamlValue.from(document);
  }

  field(name: string): YamlValue | undefined { return this.mappingEntries().get(name)?.value; }

  at(index: number): YamlValue | undefined {
    const node = this.resolve(this.node);
    if (!isSeq(node) || index < 0 || index >= node.items.length) return undefined;
    const item = node.items[index];
    if (isPair(item)) {
      const map = new YAMLMap(); map.items = [item];
      return new YamlValue(map, this.sources, item);
    }
    return new YamlValue(item, this.sources);
  }

  sameAs(other: YamlValue): boolean { return this.resolve(this.identity) === other.resolve(other.identity); }

  /** Independent default application; aliases inside that application survive. */
  fork(): YamlValue { return YamlValue.from(this.document()); }

  static mapping(fields: ReadonlyMap<string, YamlValue>, base?: YamlValue): YamlValue {
    const original = base && isMap(base.resolve(base.node)) ? base.mappingEntries() : undefined;
    if (original && original.size === fields.size && [...fields].every(([key, value]) => original.get(key)?.value.sameAs(value))) return base!;
    const node = new YAMLMap(), sources = new Set<Source>(base?.sources);
    const prior = base?.resolve(base.node);
    if (isMap(prior)) node.tag = prior.tag;
    for (const [key, value] of fields) {
      node.items.push(new Pair(original?.get(key)?.key ?? new Scalar(key), value.node));
      for (const source of value.sources) sources.add(source);
    }
    return new YamlValue(node, sources);
  }

  static sequence(items: readonly YamlValue[], base?: YamlValue): YamlValue {
    const prior = base?.resolve(base.node);
    if (isSeq(prior) && prior.items.length === items.length && items.every((value, index) => base!.at(index)?.sameAs(value))) return base!;
    const node = new YAMLSeq(), sources = new Set<Source>(base?.sources);
    if (isSeq(prior)) node.tag = prior.tag;
    node.items = items.map(value => value.node);
    for (const value of items) for (const source of value.sources) sources.add(source);
    return new YamlValue(node, sources);
  }

  /** Assign named fields while retaining opaque extra keys and merge entries. */
  static withFields(fields: ReadonlyMap<string, YamlValue>, base: YamlValue): YamlValue {
    const prior = base.resolve(base.node);
    if (!isMap(prior)) return YamlValue.mapping(fields, base);
    const original = base.mappingEntries();
    if ([...fields].every(([key, value]) => original.get(key)?.value.sameAs(value))) return base;
    const node = new YAMLMap(), sources = new Set(base.sources), assigned = new Set<string>();
    node.tag = prior.tag;
    for (const pair of prior.items) {
      const key = base.resolve(pair.key);
      const name = isScalar(key) ? String(key.value ?? "") : undefined;
      if (name !== undefined && fields.has(name) && original.get(name)?.key === pair.key) {
        node.items.push(new Pair(pair.key, fields.get(name)!.node));
        assigned.add(name);
      } else node.items.push(pair);
    }
    for (const [name, value] of fields) {
      for (const source of value.sources) sources.add(source);
      if (!assigned.has(name) && !original.get(name)?.value.sameAs(value)) {
        node.items.push(new Pair(original.get(name)?.key ?? new Scalar(name), value.node));
      }
    }
    return new YamlValue(node, sources);
  }

  private resolve(node: unknown): unknown {
    if (!isAlias(node)) return node;
    for (const source of this.sources) if (source.aliases.has(node)) return source.aliases.get(node)!;
    throw new Error(`Unresolved YAML alias: ${node.source}`);
  }

  // Sources are immutable writer inputs. Cache the namespace view so selecting
  // each field does not repeatedly traverse the same mapping/merge graph.
  private mappingEntries(): Map<string, Entry> { return this.cachedEntries ??= this.entries(); }

  private entries(): Map<string, Entry> {
    const root = this.resolve(this.node);
    if (!isMap(root)) return new Map();
    const records = new Map<string, Entry>(), copies = new Map<unknown, YAMLMap>(), visiting = new Set<unknown>();
    const project = (value: unknown): YAMLMap => {
      const node = this.resolve(value);
      if (!isMap(node)) throw new Error("YAML merge source must be a mapping");
      if (visiting.has(node)) throw new Error("Cyclic YAML merge mapping");
      if (copies.has(node)) return copies.get(node)!;
      const copy = new YAMLMap(); copies.set(node, copy); visiting.add(node);
      for (const pair of node.items) {
        if (isScalar(pair.key) && pair.key.tag === "tag:yaml.org,2002:merge") {
          const source = this.resolve(pair.value);
          if (isSeq(source)) {
            const sequence = new YAMLSeq(); sequence.items = source.items.map(project);
            copy.items.push(new Pair(pair.key, sequence));
          } else copy.items.push(new Pair(pair.key, project(source)));
        } else {
          const id = String(records.size);
          records.set(id, { key: pair.key, value: new YamlValue(pair.value, this.sources) });
          copy.items.push(new Pair(pair.key, new Scalar(id)));
        }
      }
      visiting.delete(node);
      return copy;
    };
    const owner = [...this.sources].find(source => source.nodes.has(root) || source.nodes.has(this.identity)) ?? [...this.sources][0];
    // Let the same reader select keys: merge sources first use native Map keys,
    // then project them into object names. Reimplementing this with string keys
    // incorrectly changes boolean/string collisions, null and collection keys.
    // https://eemeli.org/yaml/#collections
    const selected = project(root).toJS(owner?.document ?? new Document());
    return new Map(Object.entries(selected).map(([name, id]) => {
      const entry = records.get(String(id));
      if (!entry) throw new Error(`Missing YAML entry source for ${name}`);
      return [name, entry];
    }));
  }

  /** Serialize without mutating any source document or expanding shared graphs. */
  toString(): string {
    // Default directives expand custom handles; stream markers would close
    // Markdown frontmatter. Quotes retain multiline whitespace exactly.
    return this.document().toString({ directives: false, lineWidth: 0, blockQuote: false });
  }

  private document(): Document {
    const output = new Document(undefined, { schema: "core" });
    const tags = new Set(output.schema.tags.map(tag => `${tag.tag}/${tag.format ?? ""}`));
    for (const source of this.sources) for (const tag of source.document.schema.tags) {
      const key = `${tag.tag}/${tag.format ?? ""}`;
      if (!tags.has(key)) { output.schema.tags.push(tag); tags.add(key); }
    }
    const copies = new Map<Node, Node>(), scalarText = new Map<Scalar, string>();
    let nextAnchor = 0;
    const emit = (input: unknown, keyPosition = false): unknown => {
      const node = this.resolve(input);
      if (isPair(node)) return new Pair(emit(node.key, true), emit(node.value));
      if (!isNode(node) || isAlias(node)) return node;
      const mergeKey = keyPosition && isScalar(input) && input.tag === "tag:yaml.org,2002:merge";
      if (keyPosition && isAlias(input) && isScalar(node) && node.tag === "tag:yaml.org,2002:merge" && !copies.has(node)) {
        throw new Error("Cannot preserve a merge-key alias without its preceding definition");
      }
      // Merge operators are contextual keys, not interchangeable with Alias
      // keys in the reader. Do not invent an alias for a copied merge operator.
      const previous = mergeKey ? undefined : copies.get(node);
      if (previous && !isAlias(previous)) return new Alias(previous.anchor ??= `a${++nextAnchor}`);
      // Collection.clone() recursively clones a tree; graph emission must copy
      // each reachable node only once. This is NodeBase.clone's shallow pattern.
      // https://github.com/eemeli/yaml/blob/v2.9.0/src/nodes/Node.ts
      const copy = isScalar(node) ? node.clone() : Object.create(Object.getPrototypeOf(node), Object.getOwnPropertyDescriptors(node));
      delete copy.anchor;
      if (!copies.has(node)) copies.set(node, copy);
      if (isCollection(copy) && isCollection(node)) {
        copy.schema = output.schema;
        copy.items = node.items.map(item => emit(item)) as typeof copy.items;
      }
      if (isScalar(copy) && typeof copy.source === "string"
        && (typeof copy.value === "number" || typeof copy.value === "bigint" || copy.value instanceof Date || copy.tag)) {
        copy.tag ??= output.schema.tags.find(tag => tag.default && tag.test?.test(copy.source!))?.tag;
        if (!copy.tag) throw new Error("Parsed scalar has no YAML tag");
        scalarText.set(copy, stringify(copy.source, { defaultStringType: "QUOTE_DOUBLE", lineWidth: 0 }).trimEnd());
      }
      if (isScalar(copy) && copy.value instanceof Uint8Array && !Buffer.isBuffer(copy.value)) copy.value = Buffer.from(copy.value);
      return copy;
    };
    output.contents = emit(this.node) as Node;
    output.schema.tags = output.schema.tags.map(tag => typeof tag.stringify !== "function" ? tag : {
      ...tag, stringify: (node, ...args) => isScalar(node) && scalarText.has(node) ? scalarText.get(node)! : tag.stringify!(node, ...args),
    });
    return output;
  }
}
