# Re-typing renames and moves

Status: follow-up to the edits-and-renames decision, 2026-10-30.

## Decision

Re-typing refused any path change that needed link rewriting, so a note whose
target type files it under another name or links reaching it by path could not
be re-typed. The edit planner now does that work for the Edits and Renames
contract, so re-typing uses it instead of a second rewriter: the path change
RT-9 requires is a rename planned with `planEdit`, applied together with the
re-typed content. This supersedes the limit recorded in the
[re-typing decision](024-note-retyping.md).

## Interface

`planRetype` writes the re-typed note at its old path on the staged copy, then
plans a rename to the target path there. Notes stored through it move too, and
every link that reached a moved note is rewritten (ER-7 to ER-13). The plan
gains `moves`, `rewrites` and `edit`, the atomic write that `applyRetype` hands
to `applyEdit` (RT-12, ER-14). A taken target or a link that cannot keep
resolving is reported with its ER rule, and nothing is written. The CLI
`retype` command prints the moves and rewrites in its dry run.

## Verification

The RT-9 test now moves a note that another note links to by path and checks
the rewritten link. A new test renames through a target name pattern, rewrites
a name link with an anchor and display text, validates the result, and refuses
a taken target.

Sources: [Note Re-typing](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-retyping.md),
[Edits and Renames](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/edits-and-renames.md).
