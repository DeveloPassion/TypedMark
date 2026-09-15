import { Alias, isAlias, isCollection, isMap, isNode, isPair, Pair, parseDocument, visit, type Document, type Node } from "yaml";
import { parseMarkdownWithNodes } from "../src/frontmatter";
import { instantiateConfiguration } from "../src/system-configuration";

const identity = { name: "working", source: { name: "@example/source", version: "0.1.0" } };
const base = ["&root", "specification_version: 0.1.0", "extensions: {typedmark:systems: 0.1.0}",
  'name: "@example/source"', "description: Source", "version: 0.1.0", "scaffold: {}"];
const graph = ["x_a: &a {left: first, right: last}", "x_b: &b {left: *a, right: *a}",
  "x_c: &c {left: *b, right: *b}", "x_d: &d {left: *c, right: *c}"];
function requiredBudget(doc: Document): number {
  function accepts(limit: number): boolean {
    try { doc.toJS({ maxAliasCount: limit }); return true; } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Excessive alias count")) throw error;
      return false;
    }
  }
  if (!accepts(1000)) return Infinity;
  let low = 1, high = 1000;
  while (low < high) {
    const midpoint = Math.floor((low + high) / 2);
    if (accepts(midpoint)) high = midpoint;
    else low = midpoint + 1;
  }
  return low;
}
function reorder(doc: Document, first: string, descendingDag = false): Document {
  const copy = doc.clone();
  const aliases = new Map<Alias, Node>();
  visit(copy, { Alias(_key, node) { const target = node.resolve(copy); if (!target) throw Error("Unresolved input"); aliases.set(node, target); } });
  if (!isMap(copy.contents)) throw Error("Not a mapping");
  const name = (key: unknown) => String(isAlias(key) ? aliases.get(key) : key);
  copy.contents.items.sort((left, right) => Number(name(right.key) === first) - Number(name(left.key) === first));
  if (descendingDag) {
    const order = [first, "x_e", "x_d", "x_c", "x_b", "x_a"];
    const rank = (key: unknown) => { const index = order.indexOf(name(key)); return index < 0 ? order.length : index; };
    const snapshot = copy.contents.get(first, true);
    const originalRoot = isAlias(snapshot) ? aliases.get(snapshot) : snapshot;
    if (!isMap(originalRoot)) throw Error("Missing source snapshot mapping");
    for (const root of [copy.contents, originalRoot]) root.items.sort((left, right) => rank(left.key) - rank(right.key));
  }
  const emitted = new Set<Node>();
  let next = 0;
  function emit(input: unknown): unknown {
    const node = isAlias(input) ? aliases.get(input) : input;
    if (isPair(node)) return new Pair(emit(node.key), emit(node.value));
    if (!isNode(node) || isAlias(node)) return node;
    if (emitted.has(node)) return new Alias(node.anchor ??= `p${++next}`);
    emitted.add(node); delete node.anchor;
    if (isCollection(node)) node.items = node.items.map(emit) as typeof node.items;
    return node;
  }
  copy.contents = emit(copy.contents) as Node;
  return parseDocument(copy.toString({ directives: false, blockQuote: false }));
}

{
  const yaml = [...base, "x_root: *root", ...graph, "x_e: &e {left: *d, right: *d}"].join("\n");
  const source = parseMarkdownWithNodes(`---\n${yaml}\n---\n`);
  const output = parseDocument(instantiateConfiguration(source.frontmatter!, identity));
  const reordered = reorder(output, "x_root", true);
  const data = reordered.toJS(), snapshot = data.x_root;
  const sameGraph = snapshot !== data && snapshot.x_root === snapshot &&
    ["x_a", "x_b", "x_c", "x_d", "x_e"].every(key => data[key] === snapshot[key]) &&
    [["x_b", "x_a"], ["x_c", "x_b"], ["x_d", "x_c"], ["x_e", "x_d"]].every(([parent, child]) =>
      data[parent!].left === data[child!] && data[parent!].right === data[child!]);
  if (!sameGraph) throw Error("DAG ordering changed the graph");
  console.log(JSON.stringify({ graph: "five-level early-root DAG", source: requiredBudget(source.frontmatter!),
    current: requiredBudget(output), rootFirst: requiredBudget(reorder(output, "x_root")),
    bothRootsDescending: requiredBudget(reordered), graphPreserved: sameGraph }));
}

for (const count of [1, 50, 98]) {
  const yaml = ["!!merge <<: &shared", "  x_a: &a {value: retained}",
    ...Array.from({ length: count }, (_, i) => `  x_copy_${i}: *a`),
    ...base.slice(1).filter(line => !/^(name|version|scaffold):/.test(line)),
    "name: working", "composition: {sources: [{name: '@example/source', version: 0.1.0}]}",
    "x_root: &snapshot", "  !!merge <<: *shared", "  x_root: *snapshot",
    ...base.slice(1).map(line => `  ${line}`)].join("\n");
  const data = parseMarkdownWithNodes(`---\n${yaml}\n---\n`).data as Record<string, any>;
  console.log(JSON.stringify({ graph: `merge-hoisted ${count} references`, parsesUnderDefaultGuard: true,
    crossRootIdentityPreserved: data.x_a === data.x_root.x_a,
    withinRootIdentityPreserved: data.x_copy_0 === data.x_a && data.x_root.x_copy_0 === data.x_root.x_a }));
}
for (const early of [false, true]) {
  for (const count of [0, 25, 49, 50, 75, 98]) {
    const metadata = count === 0 ? graph : ["x_a: &a {value: retained}", ...Array.from({ length: count }, (_, i) => `x_copy_${i}: *a`)];
    const yaml = [...base, ...(early ? ["x_root: *root"] : []), ...metadata, ...(early ? [] : ["x_root: *root"])].join("\n");
    const source = parseDocument(yaml, { schema: "core" });
    let current: number | string = "source rejected", first: number | string = "source rejected";
    try {
      const parsed = parseMarkdownWithNodes(`---\n${yaml}\n---\n`);
      const output = parseDocument(instantiateConfiguration(parsed.frontmatter!, identity));
      current = requiredBudget(output); first = requiredBudget(reorder(output, "x_root"));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Excessive alias count")) throw error;
    }
    console.log(JSON.stringify({ early, graph: count === 0 ? "four-level DAG" : `${count} shared references`, source: requiredBudget(source), current, rootFirst: first }));
  }
}
