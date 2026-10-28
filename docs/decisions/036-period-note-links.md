# Links to enclosing period notes

Status: implementation of specification #174, 2026-10-28.

## Decision

The vault's periodic templates link a note to its week, month, quarter and year
notes by name. These links are body breadcrumbs, and the vault's queries use
the stored period parts. TypedMark adds no rule or relationship: a `from_date`
part, or a `computed` field joining parts, names the target note, and a
`self_field` expansion renders it as a link. A derived `belongs_to` would tie
link values to another type's naming without a query that needs it.

## Interface

No code changes. Computed fields already accept text `from_date` fields as
references, and expansions render them. The end month of a week that spans
two months, and previous or next links, still need date arithmetic.

## Verification

Two golden vectors cover a daily note in ISO week 2026-W01 and month 2025-12,
a stored week name using the calendar year (FDR-234), and a stale rendered
link (RHT-164).

Sources: [Expressions](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/expressions.md#links-to-enclosing-periods).
