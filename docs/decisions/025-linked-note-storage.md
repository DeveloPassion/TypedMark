# Linked-note storage placeholders

Status: implementation of the maintainer's decision on specification #126,
2026-10-23.

## Decision

Structured companion notes (a project's decisions, history, and so on) are
ordinary note types with a `belongs_to` field. What was missing was storage
that follows the parent: `{field:name}` and `{field:folder}` read a single
note-link field's resolved managed note (NTS-184), so
`{project:folder}/{project:name}` places a decision log at
`Projects/Launch/Decisions.md`. The maintainer chose these composable
placeholders over a dedicated companion-type construct.

Placeholders use the linked note's current path, not its expected one, so
resolution never recurses and impossible layouts surface as ordinary path
mismatches instead of needing a cycle rule.

## Interface

`resolveStoragePath`, `checkStoragePath` and `currentNamePart` take an optional
`LinkedNotePath` resolver. The validator defers path checks for types that use
these placeholders until every note is read, then resolves links with the
collection's normal rules through `linkedNotePath(model, source)`. Re-typing
uses the same resolver; scaffold import resolves among the scaffold's own notes;
automation move checks accept the new formats. `:folder` is rejected outside
`folder_pattern` (NTS-185), and an unresolved link is NTS-186.

## Verification

Nine focused tests cover companion layouts, root-level parents, mismatches,
unresolved parents, free names with affixes, and invalid declarations. One
golden vector reports a decision filed beside the wrong project.

Sources: [Storage Rules](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-type-schemas.md#storage-rules).
