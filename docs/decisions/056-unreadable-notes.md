# Report notes whose frontmatter cannot be read

Status: implements specification issue #201 (`QRY-5` to `QRY-7`), 2026-11-24.

## Decision

A note whose frontmatter cannot be parsed has no stored values. When the
collection types notes from their frontmatter (a `tag` or `frontmatter_field`
mapping, as in an Obsidian Starter Kit vault), such a note gets no type, so it
was not a query candidate: it vanished from every view, and `skipped` did not
name it. Only `validate` reported it.

A query result now carries `unreadable`: these notes, in path order, each with
its reasons (the `invalid_note_frontmatter` finding, or the generic reason when
that finding is turned off). A note is named only when its path lies in or
below the storage or archive folder of a concrete type the query admits, each
placeholder matching any non-empty text, or when such a type has no storage
block (`QRY-7`). A task board names broken notes under the task folders, not a
broken book note. A note typed by a mapping that does not read frontmatter,
such as a folder mapping, keeps its type, so it is still left out and listed in
`skipped` (`CM-619`).

`unreadable` never changes `evaluation`. `presentView` carries it, and
`renderPresentation` prints "N notes could not be read, so their types are
unknown", naming at most five with the first line of their first reason. The
golden query runner compares `unreadable` only when a case lists it, on path,
`code`, `rule_id` and `field`.

## Verification

The golden vector `query-unreadable-notes` has three query cases: a query over
every type, one over tasks, and one over captures, which names no unreadable
note. `tests/skipped-notes.test.ts` and `tests/present.test.ts` cover the list,
the storage-folder filter, the complete evaluation and the notice.
