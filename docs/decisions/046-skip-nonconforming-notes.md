# Leave out notes without a model

Status: implementation of specification #187, 2026-10-31.

## Decision

A validation run over a copy of the vault's 2,238 action notes showed that one
broken note hid every row: 79 notes with bad values failed 4 of 5 saved views
(CM-308), and later a single broken link in one note's body still failed every
task view (CM-307). Each of these notes is already reported by validation under
its own finding. Query evaluation now leaves such notes out and lists them, and
the rest of the result stands. A collection or schema that cannot be resolved
still fails the query.

## Interface

`evaluateQueryWithColumns` checks each candidate and each relationship target
with `usable`. A note with an invalid or missing field value, or with link
failures in the relationship graph, is left out and recorded. An inbound
traversal also records every note whose links could not be resolved, because
any of them might have linked to the candidate. Documents of an admitted type
that could not be modeled are recorded too. Unavailable schemas and extensions
still throw (CM-307, CM-308). `QueryResult.skipped` lists the left-out paths in
path order and is absent when nothing was left out (CM-619, CM-620). Views stay
valid, and `presentView` carries `skipped`, which `renderPresentation` prints
as "N notes left out" (CM-621).

## Verification

Five golden query cases that expected `CM-307` or `CM-308` now expect rows plus
a skipped list, and a new case keeps a valid note beside two skipped ones.
Focused tests cover partial results, outbound and inbound traversal past
unusable notes, the absent list, and the view notice. Eight existing tests now
assert the skipped list instead of a failure.
