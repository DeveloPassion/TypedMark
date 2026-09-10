import type { CollectionModel } from "./collection-model";
import { buildRelationshipGraph } from "./note-links";
import { matchesNoteType } from "./reuse";
import type { ValidationResult } from "./types";

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
    for (const kind of ["belongs_to", "related_to"] as const) {
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
  return results;
}
