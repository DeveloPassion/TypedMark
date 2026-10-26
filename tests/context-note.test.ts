import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { validateCollection } from "../src/validator";

const specification = resolve(import.meta.dir, "../../TypedMarkSpecification");
const schemaDirectory = join(specification, "schema/json-schema");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// The context-note golden collection, with a shared dataset and views enabled.
function collection(rollout: string) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-context-note-"));
  roots.push(root);
  cpSync(join(specification, "schema/fixtures/golden/context-note-valid/collection"), root, { recursive: true });
  writeFileSync(
    join(root, "typedmark.md"),
    "---\nspecification_version: 0.1.0\nname: context-note\ndescription: Shared dataset.\nextensions:\n  typedmark:expansion: 0.1.0\n  typedmark:expressions: 0.1.0\n  typedmark:queries: 0.1.0\n  typedmark:views: 0.1.0\n---\n",
  );
  mkdirSync(join(root, ".typedmark/datasets"));
  writeFileSync(
    join(root, ".typedmark/datasets/project-tasks.md"),
    "---\nspecification_version: 0.1.0\ndataset: project-tasks\ndescription: Tasks of the containing project.\nrow_identity: path\nquery:\n  specification_version: 0.1.0\n  note_types: [task]\n  where: {kind: relationship, relationship: belongs_to, context_note: true}\n  select:\n    - {kind: path, as: path}\n  order_by:\n    - {column: path}\n---\n",
  );
  writeFileSync(
    join(root, "projects/Rollout.md"),
    `---\nnote_type: project\n---\n\n<!-- typedmark:expansion {"id":"tasks","mode":"manual","state":"materialized","source":{"kind":"dataset","dataset":"project-tasks","column":"path"},"render":{"item":"- \${value}"}} -->\n${rollout}\n<!-- /typedmark:expansion -->\n`,
  );
  return validateCollection({ collectionRoot: root, schemaDirectory });
}

test("a dataset source is re-evaluated for its containing note (CM-574)", () => {
  expect(collection("- tasks/Train.md").results).toEqual([]);
  expect(collection("- tasks/Build.md\n- tasks/Train.md").results).toMatchObject([{ rule_id: "RHT-164", path: "projects/Rollout.md" }]);
});
