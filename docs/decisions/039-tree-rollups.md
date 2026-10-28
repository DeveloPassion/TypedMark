# Tree rollups

Status: implementation of specification #69, 2026-10-28.

## Decision

The Kanban Action Planner's WBS shows estimates and progress derived from
subtasks: a row's own value wins, progress is weighted by estimates, done rows
read as finished, and derived values stay on screen until someone saves them.
TypedMark adds display-only `tree.rollups` (sum, min, max, count and
weighted_mean, with an optional `done_value`) to tree views. Because a row
with several parents appears under each, an occurrence aggregates its distinct
contributing rows, so a task shared by two subtasks counts once above them
instead of once per path. A persisted
rollup field, which would need propagation across notes, is not specified.

## Interface

`validateViews` reports CM-609 for rollup columns that are repeated or not
presented, CM-610 for non-count rollups over non-number columns, CM-611 for a
weighted mean without another non-weighted-mean number weight, and CM-615 for
a state column without states. `rollUp(forest, rollups, own, done)` derives
each occurrence's values from its distinct contributors (itself when it has a
value, otherwise its children's contributors, first occurrence wins), weights
before weighted means, and marks derived values; `viewRollups` reads result rows from the evaluation
and context rows from their notes, and resolves done states from each note's
field definition.

## Verification

Two focused tests cover the golden breakdown (a task shared by two subtasks
counted once: count 6, estimate 6 rather than 8, progress 50 with a done row
at 100) and own values, context rows, min, max, count
and zero-weight means. Two golden vectors cover valid rollups and the CM-609,
CM-610, CM-611 and CM-615 failures.

Sources: [Saved Views](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/datasets-and-views.md#saved-views).
