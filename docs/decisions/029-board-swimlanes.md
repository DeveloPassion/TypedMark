# Board swimlanes

Status: implementation of specification #169, 2026-10-26.

## Decision

The Kanban Action Planner splits boards into lanes by note type or property
(#157). Saved-view boards gain `presentation.board.lanes`: one orderable scalar
projected column, lanes in ascending value order, and a final empty lane
(`empty_label`, default `None`). Query `group_by` keeps its meaning, so existing
boards that group by their own column do not change.

## Interface

View validation reports CM-569 when the lane column repeats the board column,
does not resolve, projects a type the ordering rules do not admit, or yields a
non-scalar row value. Lane layout itself is presentation; the reference tooling
validates views and does not render them.

## Verification

Two golden vectors cover a valid lane board and lanes over a list column and
over the board column.

Sources: [Saved Views](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/datasets-and-views.md#saved-views).
