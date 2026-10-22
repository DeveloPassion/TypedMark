# Trigger-relative values

Status: implementation of the maintainer's decision on specification #144,
2026-10-22.

## Decision

With lifecycle states (#127) an automation can detect the moment work becomes
done, and `only_if_empty` avoids overwriting, but `set_field.value` was only a
literal, so the date could not be stamped. `set_field` now takes exactly one of
`value` or `value_from` (CM-270). `trigger_date` writes the trigger instant's
calendar date in the collection timezone to a `date` field; `trigger_datetime`
writes the instant itself to a `datetime` field (CM-563, CM-564). The instant is
the one `older_than` uses (CM-559).

A separate key was chosen over a reserved mapping inside `value`, because a
mapping is a legitimate literal for object fields. No executable expressions
are introduced (CM-277).

## Interface

Automation validation accepts `value_from` and reports CM-563 when its field
type does not match; the usual assignability checks (computed, immutable,
constants, `id`, `note_type`) still apply first. Resolution is an executor
concern, and this repository has no executor.

Sources: [Automation Rules](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/automation-artifacts.md#automation-rules).
