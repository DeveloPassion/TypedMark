# Date-part fields

Status: implementation of specification #162, 2026-10-26.

## Decision

Periodic notes in the vault store their year, quarter, month and week, parsed
from the note name by templates. `from_date: {field, part}` derives one such
part from a sibling date with the storage formats, as part of the Expressions
extension. Links to enclosing period notes are not specified yet.

## Interface

`validateComputedFields` reports FDR-293 when the source is not a sibling date
or datetime and FDR-294 when an integer field asks for `YYYY-MM` or
`YYYY-MM-DD`. `computedFailures` compares a stored part with the source
formatted by the storage formatter (now exported as `formatted`), numeric for
integer fields and null without a source, and reports FDR-298. `hasComputed`
also detects `from_date`, so such types require Expressions.

## Verification

Two focused tests cover the declaration and value checks. Two golden vectors
cover weekly notes across an ISO year boundary and a wrong year and week.

Sources: [Expressions](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/expressions.md#from_date).
