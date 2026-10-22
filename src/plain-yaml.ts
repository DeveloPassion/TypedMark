import { isAlias, isMap, isScalar, visit, type Document, type Node } from "yaml";

/**
 * The first construct that keeps a YAML node from being plain data (SCE-159):
 * an anchor, alias or explicit tag, or a non-string mapping key. Importers
 * reject these rather than change value types; Core-schema scalars such as
 * dates stay plain strings and pass.
 * https://eemeli.org/yaml/#visiting-the-document
 */
export function plainDataViolation(node: Node | Document | null | undefined): string | undefined {
  if (!node) return undefined;
  let found: string | undefined;
  visit(node as Node, {
    Node(_key, child) {
      if (isAlias(child)) found = "an alias";
      else if (child.anchor) found = `an anchor &${child.anchor}`;
      else if (child.tag) found = `an explicit tag ${child.tag}`;
      else if (isMap(child) && child.items.some((pair) => !isScalar(pair.key) || typeof pair.key.value !== "string")) found = "a non-string mapping key";
      return found ? visit.BREAK : undefined;
    },
  });
  return found;
}
