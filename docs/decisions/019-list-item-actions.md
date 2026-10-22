# List-item automation actions

Status: implementation of the maintainer's automation decision, 2026-10-22.

## Decision

The Obsidian Starter Kit's automations add and remove single list items and
stamp values only when empty. TypedMark could only replace a whole list with
`set_field`, which races with other writers and cannot express "add this
project to `related_projects`". The specification adds `add_list_item`,
`remove_list_item` (CM-555, MN-311..MN-317) and `set_field.only_if_empty`
(CM-554, MN-310). No Core rule changes.

## Interface

Automation artifacts are validated, never executed. A list-item action must
target a top-level `type: list` field that `set_field` could target, and its
`value` must satisfy the field's `items` definition; anything else is a CM-278
target-compatibility failure. `only_if_empty` is a boolean shape check only:
its runtime effect (MN-310) and the list semantics (MN-313..MN-317) apply to
executors, which this repository does not provide.

## Verification

Focused tests cover accepted list-item actions, item constraint failures,
scalar, `const_value` and undeclared targets for both kinds, and artifact shape
failures for a missing item value and a non-boolean `only_if_empty`.

Sources: [Automation Rules](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/automation-artifacts.md#automation-rules)
and [Automation Runtime](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/automation-runtime.md).
