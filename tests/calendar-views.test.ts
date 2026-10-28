import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { readCollectionModel } from "../src/validator";
import { SchemaRegistry } from "../src/schema-registry";
import { validateViews } from "../src/views";
import { arrangeCalendar, arrangeTimeline, calendarMove, datedRows, moveDate, timelineMove } from "../src/calendar-views";

const specification = resolve(import.meta.dir, "../../TypedMarkSpecification");
const schemaDirectory = join(specification, "schema/json-schema");
const timezone = "Europe/Brussels";

function goldenViews() {
  const collectionRoot = join(specification, "schema/fixtures/golden/calendar-views-valid/collection");
  const model = readCollectionModel({ collectionRoot, schemaDirectory });
  const views = validateViews(collectionRoot, ".typedmark", model, new SchemaRegistry(schemaDirectory));
  expect(views.results).toEqual([]);
  return (id: string) => datedRows(views.sources.get(`view:${id}`)!.evaluation!);
}

test("calendar entries fall on their days per dimension, with backlogs (CM-598 to CM-600)", () => {
  const rows = goldenViews()("task-calendar");
  const dates = [
    { column: "scheduled", label: "Scheduled" },
    { column: "due", label: "Due" },
  ];
  expect(arrangeCalendar(rows, dates, { timezone, backlog: true })).toEqual({
    days: [
      {
        day: "2026-10-28",
        entries: [
          { path: "Tasks/Review.md", column: "due", label: "Due" },
          { path: "Tasks/Write.md", column: "scheduled", label: "Scheduled" },
        ],
      },
      { day: "2026-10-30", entries: [{ path: "Tasks/Write.md", column: "due", label: "Due" }] },
    ],
    backlogs: { scheduled: ["Tasks/Review.md", "Tasks/Someday.md"], due: ["Tasks/Someday.md"] },
  });
  expect(arrangeCalendar(rows, dates, { timezone }).backlogs).toEqual({});
  // A datetime with an offset falls on its day in the collection timezone.
  expect(arrangeCalendar([{ path: "late", values: { due: "2026-10-28T23:30Z" } }], [{ column: "due" }], { timezone }).days[0]!.day).toBe("2026-10-29");
});

test("timeline spans cover whole date days and reversed ends collapse to the start (CM-602 to CM-604)", () => {
  expect(arrangeTimeline(goldenViews()("plan"), { start: "start", end: "end" }, { timezone, backlog: true })).toEqual({
    spans: [
      { path: "Tasks/Review.md", start: "2026-10-28T23:00:00Z", end: "2026-10-29T23:00:00Z" },
      { path: "Tasks/Write.md", start: "2026-10-25T23:00:00Z", end: "2026-10-30T23:00:00Z" },
    ],
    backlog: ["Tasks/Someday.md"],
  });
  expect(arrangeTimeline([{ path: "call", values: { start: "2026-10-28T09:30" } }], { start: "start" }, { timezone }).spans).toEqual([
    { path: "call", start: "2026-10-28T08:30:00Z", end: "2026-10-28T08:30:00Z" },
  ]);
});

test("moved datetimes keep their wall-clock time and form, refusing DST gaps and overlaps (CM-608)", () => {
  expect(moveDate("2026-10-28", "2026-11-01", timezone)).toBe("2026-11-01");
  expect(moveDate("2026-10-30T17:00", "2026-11-02", timezone)).toBe("2026-11-02T17:00");
  expect(moveDate("2026-10-28T09:30+01:00", "2026-10-20", timezone)).toBe("2026-10-20T09:30+02:00");
  expect(moveDate("2026-10-28T08:30Z", "2026-10-20", timezone)).toBe("2026-10-20T07:30Z");
  expect(moveDate("2026-10-28T09:30:15.250+01:00", "2026-10-29", timezone)).toBe("2026-10-29T09:30:15.250+01:00");
  expect(() => moveDate("2026-03-28T02:30", "2026-03-29", timezone)).toThrow("CM-608");
  expect(() => moveDate("2026-10-24T02:30+02:00", "2026-10-25", timezone)).toThrow("CM-608");
});

test("calendar and timeline moves write one date, shift spans, and refuse reversed resizes (CM-606, CM-607)", () => {
  expect(calendarMove("due", "2026-10-30T17:00", "2026-10-31", timezone)).toEqual({ kind: "set_field", field: "due", value: "2026-10-31T17:00" });
  expect(calendarMove("scheduled", null, "2026-10-31", timezone)).toEqual({ kind: "set_field", field: "scheduled", value: "2026-10-31" });
  expect(calendarMove("due", "2026-10-30T17:00", null, timezone)).toEqual({ kind: "unset_field", field: "due" });
  const fields = { start: "start", end: "end" };
  const values = { start: "2026-10-26", end: "2026-10-30" };
  expect(timelineMove(fields, values, { kind: "shift", day: "2026-10-28" }, timezone)).toEqual([
    { kind: "set_field", field: "start", value: "2026-10-28" },
    { kind: "set_field", field: "end", value: "2026-11-01" },
  ]);
  expect(timelineMove(fields, values, { kind: "resize", endpoint: "end", day: "2026-11-03" }, timezone)).toEqual([
    { kind: "set_field", field: "end", value: "2026-11-03" },
  ]);
  expect(timelineMove(fields, values, { kind: "resize", endpoint: "end", day: "2026-10-26" }, timezone)).toEqual([
    { kind: "set_field", field: "end", value: "2026-10-26" },
  ]);
  expect(() => timelineMove(fields, values, { kind: "resize", endpoint: "end", day: "2026-10-25" }, timezone)).toThrow("CM-607");
  expect(() => timelineMove(fields, values, { kind: "resize", endpoint: "start", day: "2026-10-31" }, timezone)).toThrow("CM-607");
  expect(timelineMove(fields, values, { kind: "backlog" }, timezone)).toEqual([{ kind: "unset_field", field: "start" }]);
});
