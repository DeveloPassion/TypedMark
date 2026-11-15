# Say why a note was left out

Status: implements specification issue #195 (option A; `QRY-3`, `QRY-4`), 2026-11-15.

## Decision

Decision 046 leaves out notes whose own values or links cannot be resolved,
and views said only how many. On the maintainer's vault, a view that dropped
79 notes gave no hint of which value was wrong, so the count looked like a
bug in the view. Leaving the note out is still right (`CM-619`): showing it
would present invalid data as if it were correct. The evaluation now also
says why.

## Interface

`QueryResult` gains `skipped_details`, beside the unchanged `skipped` list:
`[{ path, results: [{ code, rule_id, field?, message }] }]`, in the same path
order, absent when nothing was left out. A reason has the shape of a
validation-report result without `severity` and `path`. Reasons come from the
points that already add a path to `skipped`: the note's own field problems,
its link failures (a link recorded for its field and again for the body is
listed once, with the field), the failures of notes that might link inbound,
and, for a document that could not be modeled, the validation findings at its
path, or a generic frontmatter or type-mapping reason when validation is
silent. `presentView` carries the member and `renderPresentation` prints,
for each of the five notes it names, the first reason, for example
`Tasks/E.md (rank: must be one of ...)`, with the "and N more" tail kept. JSON
output of `query` and `view --format json` gains the member. Saved views,
datasets and content expansions share the evaluation, so they carry it the
same way.

The golden query runner compares reasons only when a case lists them, on
`code`, `rule_id` and `field`, never on `message`, and only for the listed
reasons, since reporting them is a SHOULD. Five golden cases list theirs.

## Verification

`tests/skipped-notes.test.ts` covers reasons with field and rule, the removed
rule prefix, path order and the absent member. `tests/present.test.ts` covers
the notice with first reasons and the tail. The corpus counts do not change:
no vector was added.
