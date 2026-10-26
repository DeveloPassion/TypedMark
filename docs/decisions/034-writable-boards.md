# Writable boards and rank

Status: implementation of specification #168, 2026-10-26.

## Decision

The Kanban Action Planner writes a card's status when it moves between columns
and keeps a fractional `manual_order` within each column. Saved-view boards may
opt into `writable: true`, so a column move is an ordinary `set_field` write,
and may name a numeric `rank` that orders rows within each column; a move
writes a rank between its new neighbours. All other view writes stay
forbidden.

## Interface

View validation reports CM-576 when a writable board's column is not a `field`
projection of a top-level field `set_field` could target on every admitted
type, CM-578 when `rank` is not a projected number field, and CM-579 when a
writable board's rank is not assignable. The reference tooling validates views
and performs no board moves.

## Verification

Two golden vectors cover a valid writable board with a rank, a constant board
column and a text rank.

Sources: [Saved Views](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/datasets-and-views.md#saved-views).
