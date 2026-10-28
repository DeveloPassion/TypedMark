# Tree views

Status: implementation of specification #122, 2026-10-28.

## Decision

The Kanban Action Planner's WBS mode shows tasks under their parents: a note
with two parents appears under both, cycles are cut where a branch re-enters,
and ancestors the filter removed stay visible as read-only context. TypedMark
adds `layout: tree` over a projected parent link, with opt-in
`context: ancestors` and writable parent moves. Rollups (#69) stay out.

## Interface

`validateViews` reports CM-583 when the tree parent is not a `field`
projection of a link or list-of-links field, and CM-593 when a writable tree's
parent is not one assignable single link. `QueryEvaluation.paths` now carries
each row's note. `arrangeTree(rows, options)` builds the forest from resolved
parent paths (CM-584 to CM-592), `viewTree(model, query, evaluation, tree)`
resolves a view's parent column as note links first, and
`treeMove(forest, field, moved, parent)` returns the `set_field` or
`unset_field` write for a move, refusing context rows and moves under the row
itself or its descendants (CM-594, CM-595). The default link is a path
wikilink, so it resolves without ambiguity.

## Verification

Four focused tests cover multi-parent rows, cycle cuts and late roots, context
ancestors and their order, link resolution on the golden collection, and moves.
Two golden vectors cover valid trees and the CM-583 and CM-593 failures.

Sources: [Saved Views](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/datasets-and-views.md#saved-views).
