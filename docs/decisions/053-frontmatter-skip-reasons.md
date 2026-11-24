# Keep the frontmatter finding as the reason

Status: follows decision 052 (`QRY-3`), 2026-11-24.

## Decision

Decision 052 gives a note that could not be modeled the error findings at its
path as reasons, and a generic reason when there are none. A collection can
lower `invalid_note_frontmatter` to `warn` or `info` in `validation_defaults`.
The note is still left out, because its values cannot be read (`CM-619`), but
its finding is no longer an error, so the reason became the generic "The
note's frontmatter could not be resolved" and the parser message was lost.

Now the reasons of such a note are its error findings, or else its
`invalid_note_frontmatter` and `invalid_note_type_mapping` findings at any
severity, or else the generic reason. The generic reason remains only for a
finding that is turned `off`. Nothing changes for a note that has an error
finding.

A note with unparseable frontmatter is a candidate only when a mapping that
does not read frontmatter, such as a folder mapping, gives it a type. Under a
`frontmatter_field` or tag mapping it has no type, so it is not a candidate
and is not left out of any query; validation still reports it.

The generic `invalid_note_type_mapping` reason (`CM-114`) has no test: a note
with valid frontmatter whose winning mapping names a known concrete type is
always modeled, so the fallback cannot be reached today. It stays as a guard.

## Verification

`tests/skipped-notes.test.ts` covers three kinds of unparseable frontmatter
(an unclosed flow sequence, a sequence instead of a mapping, a duplicate key)
under a folder mapping: each note is left out with one `MN-118` reason that
carries the parser message. With the severity at `warn` or `info`, the reason
keeps the parser message; with `off`, it is the generic reason. The `warn`
case fails without this change. No vector was added, so the corpus counts do
not change.
