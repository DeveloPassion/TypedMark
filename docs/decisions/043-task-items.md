# Task items

Status: implementation of specification #79 (read-only), 2026-10-30.

## Decision

The unit of typing stays the note, but the vault keeps much of its work in
checklists: 803 of 2,064 task notes and about 400 other notes contain
`- [ ]` items. Its "Tasks Journal" board lists the open ones through Dataview's
`file.tasks`. TypedMark adds the `typedmark:items` extension: a query with
`rows: items` returns one row per task item. Items are read, not typed: they
have no identity beyond their line in one snapshot, no item schema, and no
writes, so views over them cannot be writable. Any bracketed character is a
status, as editors use `[/]` and `[-]`.

## Interface

`taskItems(body, bodyLine)` parses a body with the pinned CommonMark block
parser and returns each item's `text`, `status`, `checked`, `line`, `depth`,
`parent_line` and `heading` (ITM-6 to ITM-12). The reader records the line each
note body starts on (`bodyLine`), so `line` counts frontmatter lines.
`evaluateQueryWithColumns` expands admitted notes into item rows before the
`where` filter, evaluates `item` predicates and projections, breaks ties by line,
and returns `lines` beside `paths` (ITM-2 to ITM-4, ITM-13 to ITM-17). An `item`
predicate or projection outside `rows: items`, or inside a relationship
predicate, fails with ITM-14. A regex on a non-text property or an incompatible
operand fails with ITM-16. Views report ITM-18 for a writable presentation over
item rows, and EXT-16 when an item query is used without `typedmark:items`.
Expansion markers with an item query need the declaration too.

## Verification

Focused tests cover tabs, emoji and custom statuses, HTML blocks, nested
ordered items, CRLF bodies, continuation lines that are not items, row lines,
the ITM-14 failures and the EXT-16 finding. Two golden vectors cover five
query cases and the ITM-18 failure.

Sources: [Task Items](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/items.md).
