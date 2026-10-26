# Fix advice in validation results

Status: implementation of specification #167, 2026-10-26.

## Decision

The Starter Kit pairs findings with repair commands (add missing tags or
properties, move to the type's folder). Validation results gain an optional
`fix`: one automation action, offered only when the schema and the note
determine it. Validation never applies it and conformance comparison ignores it.

## Interface

`ValidationResult.fix` is a `FixAction`. The validator offers `add_tag` for a
missing mandatory tag when `tags` is a list (MN-128), `unset_field` for a
stored null over a non-null default (MN-99), and `move_note` for a path
mismatch whose expected path is fully resolved (NTS-146); a free-name contract
needs the author's name, so it gets no move. `stableReport` drops `fix` with
`message`.

## Verification

Two focused tests cover the three fixes, schema validity of the report, and the
absence of fixes when a domain value is missing.

Sources: [Validation Reports](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/conformance-and-roadmap.md#validation-reports).
