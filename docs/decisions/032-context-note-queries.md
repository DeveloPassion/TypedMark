# Context-note queries

Status: implementation of specification #163, 2026-10-26.

## Decision

Every project note in the vault embeds one shared task view filtered to itself.
Relationship predicates gain `context_note: true`, which keeps only the managed
note containing the evaluating content expansion (CM-573, CM-574). Anywhere
else there is no context note and the predicate retains nothing (CM-575), so a
dataset or view using it still validates on its own.

## Interface

`evaluateQueryWithColumns` takes an optional context-note path, and
`usesContextNote` tells whether a descriptor needs one. Expansion `query`
sources pass their managed containing note; `dataset` and `view` sources reuse
the shared evaluation unless their descriptor uses `context_note`, in which case
it is re-evaluated for the containing note. `TabularSource.query` carries the
evaluated descriptor, a view's being its dataset's.

## Verification

Two golden vectors cover one inline query shared by two projects, materialized
correctly and with another project's task. A focused test covers a
dataset-backed source re-evaluated per project.

Sources: [Relationship Predicates](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/queries.md#relationship-predicates).
