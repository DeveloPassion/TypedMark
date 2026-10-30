# List-parent tree moves

Status: implementation of specification #179, 2026-10-30.

## Decision

The vault links tasks and projects to their parents through list properties
(`related_projects`, `related_goals`), so writable trees over a single link
could not edit its own hierarchy. A tree over a list of links is now writable,
and a move changes only the dragged occurrence. The new parent's link takes the
old parent's slot, so the diff is one line and the order of the other items
survives. When the row already lists the new parent, the move only removes the
old one. Every move stays one whole-list `set_field` write: no new automation
action kind.

## Interface

`validateViews` reports CM-593 only when a writable tree's parent is not an
assignable link or list-of-links field. `treeListMove(forest, field, moved,
from, to, items, resolve)` returns the write that moves the occurrence of
`moved` under `from` (null for a root occurrence) to `to` (null for the root),
given the row's current list and a resolver for its items (CM-617, CM-618).
Items that resolve to the old parent collapse into its one slot, a move to the
root unsets the field when the list empties, and a root occurrence moved under
a row appends a link. It refuses an occurrence that does not exist (CM-617) and
the `treeMove` cases (CM-595), which both functions now share.

## Verification

A focused test covers slot replacement at the first and last position,
duplicates, a target that is already listed, moves to the root, a root
occurrence moved under a row, and the refusals. The tree golden vectors now
treat a writable list parent as valid and an immutable one as the CM-593
failure.

Sources: [Saved Views](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/datasets-and-views.md#saved-views).
