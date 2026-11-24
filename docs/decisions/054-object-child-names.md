# Lower camel case for object children

Status: implements specification issue #198 (`MN-25` narrowed, `MN-322`),
2026-11-24.

## Decision

Some editors write nested keys in lower camel case. TaskNotes stores time
tracking as `time_entries` items with `startTime` and `endTime`, so a schema
could declare those items only as `any`, which validates nothing. The
specification now allows `^[a-z][a-zA-Z0-9_]*$` for a field declared in an
`object.fields` mapping (`MN-322`); top-level names keep `^[a-z][a-z0-9_]*$`
(`MN-25`).

The name grammar is checked by the JSON Schemas, which the tooling loads from
the specification checkout, so the schema check needs no tooling change. One
place in the validator had its own copy of the grammar: the `field` context of
an `unknown_field` finding is omitted when a segment cannot be written as a
field path (`CR-38`). It now accepts lower camel case for every segment after
the first, so an undeclared `pomodoroId` in a time entry is reported with
`field: time_entries.pomodoroId`.

## Verification

The golden vector `object-child-names-invalid` declares time entries with
`startTime` and `endTime` and has one valid note and one note with a bad
datetime and an undeclared camel-case child. `tests/core-fields.test.ts`
covers the `field` context and the rejection of a camel-case top-level name.
The corpus now reports 116 discovered and 114 passed, with the two
precondition skips, and 27 queries passed.
