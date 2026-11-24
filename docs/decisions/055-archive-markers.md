# Archive markers

Status: implements specification issue #197 (`typedmark:archive-markers`, `ARC-1` to `ARC-12`), 2026-11-24.

## Decision

Vaults built on the Obsidian Starter Kit, and many other Obsidian vaults, mark
an archived note only by its folder. The tooling read such a note as active:
it failed the active storage pattern, and a view of active notes listed it.
The dogfood had to add `archived: true` to every archived note of its copy.
The specification now lets a collection say which notes are archived without
a stored value, and the tooling derives the value.

## Interface

`src/archive-markers.ts` holds the shared logic. `archiveMarkersApply(config)`
is true when the collection declares `typedmark:archive-markers` at `0.1.0`
and lists markers. `markerArchived(config, path, stored, hasFrontmatter)`
returns the derived state, or `undefined` when markers do not apply or the
note stores `archived` (`ARC-7`). A marker is matched like a `kind: fixed`
mapping, on the normalized path and the stored frontmatter only (`ARC-5`).

- `validateCollection` supplies the derived state as the absence fallback of
  `archived` (`ARC-6`). Every consumer of the model therefore reads it:
  storage selection, query predicates, views, the edit planner. The shape of
  `archive_markers` is checked only when the extension is evaluated, like
  `automation_defaults`. An undeclared use reports `EXT-16` and is not applied.
  A marker regular expression that does not compile reports `FND-31` under
  `invalid_collection_configuration` and stops association, because no
  storage contract is known without the markers.
- `planEdit` selects storage from the effective value, so re-filing keeps a
  marker-archived note under the archive contract (`ARC-11`). When a move takes
  such a note out of every marker and the caller does not set `archived`, the
  planner adds `archived: true` to the note (`ARC-12`). It never writes the
  value otherwise (`ARC-10`).
- `planRetype` and system instantiation derive the state the same way before
  they select a storage contract.

The adapter advertises `typedmark:archive-markers` at `0.1.0`.

## Verification

`tests/archive-markers.test.ts` covers derivation, stored precedence, the
frontmatter predicates without frontmatter, an undeclared use, a bad pattern,
the year check and stored `false`, query predicates, re-filing, a move out of
every marker, an explicit unarchive, and re-typing. Three golden vectors are
added: the corpus reports 118 discovered, 116 passed and 29 queries passed,
with the two precondition skips.
