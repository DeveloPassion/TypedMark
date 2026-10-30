# View command

Status: tooling follow-up to the view layouts (decisions 037 to 039, 041, 043), 2026-10-30.

## Decision

Trees, rollups, calendars, timelines and item rows were library functions, and
boards had no arrangement function at all: only their validation existed. No
command showed a saved view, so neither a user nor the example system could see
one. The tooling now has a read-only `view` command that evaluates one saved
view and prints its arrangement, as text for a terminal or as JSON for other
tools. It writes nothing, and a view with a validation finding is reported
instead of shown in part.

## Interface

`presentView(collectionRoot, schemaDirectory, viewId)` validates the view, then
returns a `Presentation`: the presented fields with their display names
(CM-417, CM-427), plus one of these shapes:

- rows, with query groups as sections, for tables, lists and cards (CM-429 to CM-432);
- lanes of declared columns ordered by rank, plus an unmapped column (CM-434, CM-439 to CM-444, CM-568 to CM-572, CM-578);
- a tree whose context rows show the projections on their own note and whose rolled-up values are marked (CM-592, CM-616);
- calendar days and backlogs, or timeline spans and a backlog, in the collection timezone (CM-598 to CM-604).

Item rows keep their line, so two items of one note stay distinct.
`arrangeBoard` is exported for other presenters. `renderPresentation` prints
the text form, with whole-day spans as inclusive local days and a `*` on
values rolled up from children. The CLI is
`bun src/cli.ts view <collection> <view-id> --schemas <dir> [--format text|json]`.
It exits 1 with the rule ID when the view is unknown (CM-409) or invalid.

## Verification

Focused tests cover board lanes, rank and the unmapped column, grouped lists
whose groups are not contiguous, cards, context rows and rollup marks, calendar
and timeline placement, distinct item rows, and the refusals. The golden view
collections render without findings.
