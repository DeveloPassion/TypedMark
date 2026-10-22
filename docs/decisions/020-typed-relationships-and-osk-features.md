# Typed relationships and other Obsidian Starter Kit features

Status: implementation of the maintainer's decisions on specification
#137–#142, 2026-10-22.

## Decisions

A review of recent Obsidian Starter Kit (OSK) improvements found that
TypedMark already covered typed link fields, but not how real vaults store
relationships: both directions are written (`related_tasks` on projects,
`related_projects` on tasks), parents list children, tasks list blockers, and
work is archived a grace period after it finishes. The maintainer chose:

| Issue | Decision |
| --- | --- |
| #137 | Raise the Core budgets to 650 rules / 21,500 reading-path words. |
| #139 | Field `targets` must be declared under the field's kind (FDR-164); one field per kind and concrete target type (RHT-292). |
| #140 | Add `contains` and `depends_on`; `depends_on` must be acyclic (RHT-293..295). |
| #138 | Optional `inverse` on relationship fields; one-sided links are `inverse_mismatch`, default `warn` (RHT-296..300, CM-556). |
| #141 | Heading entries may be `{text, description}`; `capture_h2` names a declared heading (RHT-301..303). |
| #142 | `older_than` in automation `when` only, evaluated at the trigger instant (CM-557..559). |

Inverse synchronization stays out of scope (#18): the check reads files at
rest and never writes.

## Interface

- `RELATIONSHIP_KINDS` lists the four kinds; the relationship graph, cardinality,
  reuse merging, queries and expansions iterate it.
- The graph also records `fieldTargets`, the resolved non-deleted managed
  targets per relationship-bearing field, for inverse checks.
- `depends_on` cycles use an iterative Tarjan SCC, so long chains cannot
  overflow the stack; every note on a cycle, including a self-dependency, is
  reported, but not notes that only depend on a cycle.
- Inverse definition errors (RHT-297/298) and the new target checks (FDR-164,
  RHT-292) are `invalid_relationship_definition`; `capture_h2` errors are
  `invalid_note_type_schema`.
- Heading entries are normalized to their text in the effective schema.
- `older_than` is validated as artifact shape and field type only; there is no
  automation executor here.

## Verification

Focused tests cover each rule, including abstract target expansion, a
3,000-note dependency chain, self-inverse `related_to` fields, severity
overrides, and mapping predicates rejecting `older_than`. Four golden vectors
and one query case were added; no earlier vector record changed.

Sources: [Relationship Model](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/relationships-headings-and-templates.md#relationship-model),
[Automation Rules](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/automation-artifacts.md#automation-rules),
and [Tarjan, Depth-first search and linear graph algorithms (1972)](https://doi.org/10.1137/0201010).
