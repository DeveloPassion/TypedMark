# Free note names

Status: implementation of the maintainer's storage decision, 2026-10-22.

## Decision and boundaries

Specification #134 showed that subject-first names (`net.proto.bgp`,
`smith.john`) could only conform by storing a field that duplicated the
filename and drifted on every outside rename. The maintainer chose free names:
`note_name_pattern` becomes optional, and without it the name part is chosen by
the author (NTS-181). An optional ECMA-262 `note_name_regex` constrains its shape
(NTS-182) and cannot accompany `note_name_pattern`. Archive blocks take the same
optional name keys.

Placeholder transforms such as `{title|slug}` were rejected: the reporter's
names are not a function of one field. `{title}` without a stored title already
accepts any basename through the Core fallback; the specification now says so
rather than making that case invalid.

## Interface

`checkStoragePath(storage, path, values, fields, timezone)` checks an existing
note. For a pattern contract it resolves and compares as before. For a free name
it resolves the folder and affixes, takes the basename text between them as the
free name, and applies NTS-181, NTS-182 and the existing safety rules. A path
outside the folder or affixes returns a placeholder path
(`notes/<free name>.md`) that never equals a real path, so callers report the
usual NTS-146 mismatch.

`resolveStoragePath` takes an optional caller-supplied `freeName`; without one,
a free-name contract fails NTS-181 rather than inventing a name (NTS-150).
Scaffold import checks the system author's declared paths the same way.
Automation move checks approximate a free name as one unconstrained placeholder,
as they already do for field placeholders.

No tooling writer moves notes yet, so NTS-183 (keep the name when moving to a
free-name contract) has no implementation to change.

## Verification

Eleven focused tests cover title independence, regex matching, field-derived
affixes, folder and affix mismatches, empty free names, safety rules, archive
branches in both directions, invalid regular expressions, the mutual exclusion
and NFC comparison. Two golden vectors separate valid names from folder, affix,
empty-name and regex failures.

Sources: [Storage Rules](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-type-schemas.md#storage-rules),
[FND-29](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/foundations.md),
and [specification #134](https://github.com/DeveloPassion/TypedMarkSpecification/issues/134).
