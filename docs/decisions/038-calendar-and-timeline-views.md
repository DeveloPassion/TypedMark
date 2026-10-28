# Calendar and timeline views

Status: implementation of specification #121, 2026-10-28.

## Decision

The Kanban Action Planner's calendar plots scheduled and due dates together,
keeps a backlog per missing date and lets a drag set or clear one date.
TypedMark adds `layout: calendar` with one or more date dimensions and
`layout: timeline` with a start and an optional end, both with opt-in
backlogs and writable moves. A moved datetime keeps its wall-clock time in
the collection timezone and its stored form; a move landing on a skipped or
repeated local time is refused instead of guessed.

## Interface

`validateViews` reports CM-597 for a calendar dimension that is not a
projected date or datetime field or repeats another, CM-601 for a timeline
start or end that is not one (or an end repeating the start), and CM-605 for
writable dates that are not assignable. `datedRows(evaluation)` pairs rows
with their notes; `arrangeCalendar` and `arrangeTimeline` place them
(CM-598 to CM-604). `moveDate`, `calendarMove` and `timelineMove` return the
writes for a drop, shift, resize or backlog move (CM-606 to CM-608). A date
end is reversed when its day precedes the start's day.

## Verification

Four focused tests cover calendar placement and backlogs on the golden
collection, spans and reversed ends, datetime moves across the Brussels DST
changes, and calendar and timeline writes. Two golden vectors cover valid
views and the CM-597, CM-601 and CM-605 failures.

Sources: [Saved Views](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/datasets-and-views.md#saved-views).
