# Note folders

Status: implements specification issue #191 (`NTS-198`, `NTS-199`), 2026-11-04.

## Decision

The vault dogfood showed that every active project sits in a folder named
after it, such as `Projects/Launch/Launch (Project).md`, and that some
archived projects do too. Storage contracts now accept `note_folder: required`
or `note_folder: optional`. The folder takes the note's name part, so the
suffix is not repeated in the folder name. A writer moves only the note; files
stored through it follow under ER-13, and other files in the folder stay.

## Interface

`AffixPresence` gains `folder`. `resolveStoragePath` adds the note folder when
the contract requires it, or when `present.folder` asks for an optional one
(NTS-190). `checkStoragePath` treats an optional folder as present exactly when
the parent is the resolved folder plus the name part (NTS-199). When only the
folder is wrong, it returns the exact expected path, so validation offers a
`move_note` fix. `inNoteFolder` tells the edit planner and re-typing whether
the source note sits in its own folder, so a move keeps it (NTS-191). The edit
planner judges this under the contract the note is filed by now, so archiving
keeps the folder. `storageAccepts` tries both placements of an optional
folder.

## Verification

Two golden vectors (`storage-note-folder-valid`, `storage-note-folder-invalid`)
and `tests/storage-note-folders.test.ts`. On a copy of the vault's 100 project
notes (59 active, 41 archived), the path check reports 65 errors without
`note_folder` and none with `note_folder: optional`.
