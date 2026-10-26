# Creation inputs

Status: implementation of specification #161, 2026-10-26.

## Decision

Templates in the vault prompt for specific fields when a note is created (a
task asks for urgency, priority, necessity, impact and effort, each skippable).
Note-type schemas gain `inputs`, an ordered list of effective or Core fields a
writer asks for; prompts reuse each field's label and description. Inputs
inherit like `template`.

## Interface

Effective-schema composition reports NTS-194 for an input that is not an
effective or Core field (or is `note_type`) and NTS-195 for a computed,
generated or constant one. The reference tooling has no interactive creation
flow, so it validates the declaration only.

## Verification

Two golden vectors cover valid inputs, including a Core field, and an
undeclared and a generated input.

Sources: [Creation Inputs](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-type-schemas.md#creation-inputs).
