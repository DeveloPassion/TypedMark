# Note-folder moves

Status: implements specification issue #193 (`ER-16` to `ER-18`), 2026-11-04.

## Decision

A note in a folder of its own usually owns that folder: in the maintainer's
vault, project folders hold 80 other notes and 11 canvases. With decision 050
alone, a rename or an archive move left that folder behind without its note.
The edit planner now carries the rest of the folder when the note moves to
another folder of its own. Every file keeps its path relative to the note. A
caller can ask to move only the note with `--only-note`. When the note leaves
its folder for a flat path, the other files stay, and the plan lists them.

## Interface

`EditRequest` gains `onlyNote`. `EditPlan` gains `carried` (other files, moved
as they are, so binary files stay intact) and `leftBehind`. Carried Markdown
documents join `moves` and get the same link rewriting as the note. Link
resolution in the planner now also covers asset targets, so links to carried
files are rewritten, and relative attachment links from a moved note keep
working (ER-10). Carrying and re-filing (ER-13) repeat until nothing else
moves. `applyEdit` moves carried files after the staged writes, then removes
the folders the move emptied. Re-typing inherits all of this through the
edit planner.

## Verification

`tests/storage-note-folders.test.ts` covers a rename that carries a sub-note,
a canvas and a binary image in a subfolder, with every link rewritten; the
`onlyNote` option; an archive move to a flat path; and a taken target, which
refuses the whole move.
