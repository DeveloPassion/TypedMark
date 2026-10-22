# Lifecycle states

Status: implementation of the maintainer's decision on specification #127,
2026-10-22.

## Decision

Automations and tools need to ask "is this note done?" without hard-coding
each type's status values. Following the Obsidian Starter Kit, a top-level
`text` field with `allowed_values` or `allowed_values_from` may declare
`states`, annotating values with `done`, a success or failure `outcome`, or a
planning `role` (FDR-288..292). Automations test them with a `state` predicate
in `when` and react to entering or leaving them with `to_state` / `from_state`
change predicates (CM-560..562).

Annotations are per value, so conformance stays stateless; legal transitions
remain specification #80. Stamping the trigger's date on entering a state needs
a trigger-relative value and is tracked separately in specification #144.

## Interface

`validateFieldDefinition` reports FDR-288 when a `states` key is not an allowed
or vocabulary value under field-value equality. Annotation shape (`outcome`
only when done, no `role` when done) is enforced by the JSON Schema. Automation
validation accepts the new predicate keys and reports CM-560 or CM-562 when a
target type's field declares no `states`. There is still no executor.

## Verification

Focused tests cover allowed and vocabulary values, case-sensitive mismatches,
both predicate forms and artifact shapes. One golden vector rejects a state
outside `allowed_values` while a vocabulary-backed type stays valid.

Sources: [`states`](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/field-definition-reference.md#states)
and [Automation Rules](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/automation-artifacts.md#automation-rules).
