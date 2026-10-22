import type { CollectionModel } from "./collection-model";
import { buildRelationshipGraph } from "./note-links";
import { matchesNoteType } from "./reuse";
import { RELATIONSHIP_KINDS, type ValidationResult } from "./types";

export function validateRelationships(model: CollectionModel): ValidationResult[] {
  const results: ValidationResult[] = [];
  const graph = buildRelationshipGraph(model, (actual, requested) => matchesNoteType(model.schemas, actual, requested));
  const notes = new Map(model.notes.map((note) => [note.path, note]));
  for (const note of model.notes) {
    const failures = graph.failures.get(note.path);
    for (const failure of failures ?? []) if (!failure.schemaIssue) results.push({ code: failure.rule_id === "FDR-160" ? "invalid_field_value" : "invalid_note_link", severity: "error", path: note.path, note_type: note.noteType, ...(failure.field ? { field: failure.field } : {}), rule_id: failure.rule_id, message: failure.message });
    // A missing schema model prevents cardinality evaluation. Ordinary invalid
    // links contribute no instance and do not hide unsatisfied minimums.
    if (failures?.some((failure) => failure.schemaIssue)) continue;
    const schema = model.schemas.get(note.noteType)!;
    for (const kind of RELATIONSHIP_KINDS) {
      const declarations = schema.relationships?.[kind]?.allowed_note_types ?? {};
      const counts = new Map<string, number>(Object.keys(declarations).map((target) => [target, 0]));
      for (const path of graph.targets.get(note.path)![kind]) {
        let type: string | undefined = notes.get(path)!.noteType;
        const seen = new Set<string>();
        while (type && !seen.has(type)) {
          if (counts.has(type)) { counts.set(type, counts.get(type)! + 1); break; }
          seen.add(type); type = model.schemas.get(type)?.extends;
        }
      }
      for (const [target, count] of counts) {
        const range = declarations[target];
        if (count < (range.min ?? 0) || count > (range.max ?? Infinity)) results.push({ code: "invalid_relationship_instance", severity: "error", path: note.path, note_type: note.noteType, relationship: kind, rule_id: "RHT-31", message: `${kind} target ${target} has ${count} resolved instances` });
      }
    }
  }
  for (const path of dependencyCycles(graph)) {
    results.push({ code: "invalid_relationship_instance", severity: "error", path, note_type: notes.get(path)!.noteType, relationship: "depends_on", rule_id: "RHT-294", message: "depends_on instances form a cycle through this note" });
  }
  return results;
}

/**
 * Notes on a depends_on cycle (RHT-294), including self-dependencies, in
 * collection order. Tarjan's strongly connected components, iterative so deep
 * dependency chains cannot overflow the call stack.
 * https://doi.org/10.1137/0201010
 */
function dependencyCycles(graph: ReturnType<typeof buildRelationshipGraph>): string[] {
  const edges = (path: string) => [...(graph.targets.get(path)?.depends_on ?? [])];
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>();
  const cyclic = new Set<string>();
  let counter = 0;
  for (const root of graph.targets.keys()) {
    if (index.has(root)) continue;
    const work: Array<{ path: string; next: number }> = [{ path: root, next: 0 }];
    index.set(root, counter); low.set(root, counter++); stack.push(root); onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1]!, targets = edges(frame.path);
      if (frame.next < targets.length) {
        const target = targets[frame.next++]!;
        if (!index.has(target)) {
          index.set(target, counter); low.set(target, counter++); stack.push(target); onStack.add(target);
          work.push({ path: target, next: 0 });
        } else if (onStack.has(target)) low.set(frame.path, Math.min(low.get(frame.path)!, index.get(target)!));
        continue;
      }
      work.pop();
      if (work.length) { const parent = work[work.length - 1]!.path; low.set(parent, Math.min(low.get(parent)!, low.get(frame.path)!)); }
      if (low.get(frame.path) !== index.get(frame.path)) continue;
      const component: string[] = [];
      let member: string;
      do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== frame.path);
      if (component.length > 1 || edges(frame.path).includes(frame.path)) for (const path of component) cyclic.add(path);
    }
  }
  return [...graph.targets.keys()].filter((path) => cyclic.has(path));
}
