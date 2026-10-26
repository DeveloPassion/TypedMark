# Field removal and emptiness and ordering predicates

Status: implementation of specification #164 and #165, 2026-10-26.

## Decision

The vault gap analysis (#158) found 26 Obsidian Starter Kit rules that remove a
property (clear a loan date, drop due dates on done) and guards such as
`copies gt 1` or `lent_to unset`. TypedMark adds `unset_field`, which removes
the stored key so the effective value returns to the field's absence fallback
(MN-319), and `when` predicates `empty` (CM-565) and the four ordering
operators (CM-566) with portable-query ordering on effective values. Boolean
composition in `when` stays out: every conditioned OSK rule is a conjunction.

## Interface

The reference tooling validates automation artifacts; it does not execute them.
`validateAutomationRule` accepts `unset_field` on fields `set_field` could
target (MN-318) and reports CM-278 when the field has no conforming absence
fallback: not nullable, no default and not a Core field with a fallback
(MN-320). Ordering predicates need a field type admitted by CM-334 on every
target type and an operand valid for it (CM-401); both failures are CM-566.
`empty` applies to any field. Structure projection keeps the new keys.

## Verification

Three focused tests cover removal targets and fallbacks, emptiness and ordering
types and operands. Two golden vectors cover valid rules and an ordering
predicate on a list field and a removal of an immutable field.

Sources: [Automation Rules](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/automation-artifacts.md#automation-rules),
[Action Effects and Atomicity](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/automation-runtime.md#action-effects-and-atomicity).
