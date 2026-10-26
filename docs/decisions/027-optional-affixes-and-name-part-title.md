# Optional affixes and the name-part title

Status: implementation of specification #159 and #160, 2026-10-26.

## Decision

A note-name affix can be a decoration: `optional: true` on `note_name_prefix`
or `note_name_suffix` lets conforming names carry it or not (NTS-188). The
vault gap analysis (#158) found 28 of 69 Obsidian Starter Kit types declaring
such suffixes, with none of the 708 permanent notes carrying one.

Every tool around the vault also strips affixes from titles, so the Core
`title` absence fallback is now the note's name part: the basename without the
resolved affixes it carries (NTS-192). `Launch (Project).md` is titled
`Launch` without a stored duplicate.

## Interface

`namePart` returns the name part and which affixes were removed. A required
affix is removed whenever present, so an empty free name stays NTS-181 and a
missing affix stays a path mismatch; overlapping affixes are kept; an optional
affix is removed only when text remains (NTS-189); an affix that cannot be
resolved, or reads `title` while the note stores none, is kept (NTS-193).

`checkStoragePath` expects an optional affix exactly when the note carries it.
`resolveStoragePath` leaves optional affixes out unless its new `present`
argument asks for them (NTS-190). Re-typing keeps a carried decoration when the
source affix was optional (NTS-191). `titleFallback` is shared by validation,
scaffold materialization and system import; validation now settles `title`
after the other fields so affixes can read them. Automation move checks accept
both forms of an optional affix.

`currentNamePart` now strips affixes for name-pattern sources too, matching the
specification's single name-part definition.

Known limit: the title fallback resolves affixes without the collection, so an
affix using a linked-note `:name` placeholder is kept in the fallback title.

## Verification

Seven focused tests cover presence and absence, empty and overlapping names,
writer omission, the title fallback (date prefix, title-dependent prefix,
archive branch), heading checks and automation path acceptance. Two golden
vectors cover valid optional and required suffixes and three failures.

Sources: [Storage Rules](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-type-schemas.md#storage-rules),
[Core-defined fields](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/managed-notes-and-properties.md#core-defined-frontmatter-field-names).
