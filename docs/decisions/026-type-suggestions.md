# Type suggestions for untyped notes

Status: implementation of specification #119, 2026-10-23.

## Decision

A note can look untyped because its `note_type` is misspelled, it sits in the
wrong place, or it never had one. The specification stays deterministic:
association comes only from `note_type_mappings`, and a validator never guesses
(the manifesto's premise, and #119's triage in #123). A tool may suggest a type,
so this repository offers suggestions as advice, never as conformance.

## Interface

`suggestTypes(collection, schemas)` scores every concrete type for each
collection note that associates with none, and returns at most three candidates
with explicit reasons and a confidence:

| Evidence | Weight |
| --- | --- |
| stored `note_type` within a small edit distance of the type name | 0.6 |
| path accepted by the type's storage (active or archive) | 0.3 |
| share of non-Core fields in common (Jaccard) | up to 0.3 |
| every shared value valid for the type | 0.1 |
| the type's own mandatory tags present | 0.1 |
| a required type field missing | -0.15 |

Confidence is `high` at 0.7 or more with a 0.2 margin over the runner-up,
`medium` from 0.4, and `low` otherwise. `applySuggestions` stores `note_type`
only for high-confidence suggestions and reverts any note that would then fail
validation. The CLI `suggest-types` command is read-only unless `--write`.

## Verification

Six tests cover misspellings, untyped notes identified by fields and folder,
weak evidence, managed notes, writing only valid high-confidence types while
preserving the body, and notes without frontmatter. One bug found while writing
them is fixed: types without mandatory tags no longer earn the tag bonus.
