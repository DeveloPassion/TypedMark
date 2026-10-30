# Item links

Status: implementation of the item `links` property (ITM-19), 2026-10-30.

## Decision

The vault has 7,053 checklist items in its actions and journals. None of them
has an inline field, an emoji date or a block ID, but 617 of them link to a
note. A project can therefore find the open items that mention it only if
item rows expose those links. Item rows gain `links`: the managed notes that
the item's text links to, resolved like any body link, once each and in order
of first appearance. Unresolved links, ambiguous links and links to assets are
left out. Inline fields, identity and writes stay deferred (#185).

## Interface

The query engine resolves each item's `links` from its `text`, using
`inspectBodyLinks`, `parseNoteLink` and `resolveNoteLink` against the item's
note. `item` predicates on `links` use `contains_any` or `contains_all` with a
non-empty list of note paths. Every other operator on `links`, and containment
on any other property, fails with ITM-16. Ordering by `links` fails with
CM-374, because it is a list.

## Verification

The golden collection adds a checked item to the project note. It links to a
daily note twice, to its own note, and to a missing note. A new query case
finds it by containment, and another case shows that `equals` on `links` fails.
Focused tests cover `contains_all`, an unmatched path and the operand errors.
