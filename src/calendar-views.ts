import { Temporal } from "@js-temporal/polyfill";

type Data = Record<string, unknown>;
export interface DatedRow {
  path: string;
  values: Data;
}
export interface CalendarEntry {
  path: string;
  column: string;
  label: string;
}
export interface Calendar {
  days: Array<{ day: string; entries: CalendarEntry[] }>;
  backlogs: Record<string, string[]>;
}
export interface TimelineSpan {
  path: string;
  /** Inclusive start instant. */
  start: string;
  /** Exclusive end instant; equal to start for a datetime point. */
  end: string;
}
export interface Timeline {
  spans: TimelineSpan[];
  backlog: string[];
}
export type DateWrite = { kind: "set_field"; field: string; value: string } | { kind: "unset_field"; field: string };

export class DateMoveError extends Error {
  constructor(
    readonly rule_id: string,
    message: string,
  ) {
    super(`${rule_id}: ${message}`);
  }
}

const isDate = (value: string) => !value.includes("T");
const zoned = (value: string, timezone: string): Temporal.ZonedDateTime =>
  /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? Temporal.Instant.from(value).toZonedDateTimeISO(timezone)
    : Temporal.PlainDateTime.from(value).toZonedDateTime(timezone, { disambiguation: "reject" });

/** The day a date or datetime falls on in the collection timezone (CM-598, CM-602). */
export function dayOf(value: string, timezone: string): string {
  return isDate(value) ? value : zoned(value, timezone).toPlainDate().toString();
}

// A date covers its whole day; a datetime is one instant.
function bounds(value: string, timezone: string): { begin: Temporal.Instant; end: Temporal.Instant } {
  if (!isDate(value)) {
    const instant = zoned(value, timezone).toInstant();
    return { begin: instant, end: instant };
  }
  const day = Temporal.PlainDate.from(value);
  return {
    begin: day.toZonedDateTime({ timeZone: timezone }).toInstant(),
    end: day.add({ days: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant(),
  };
}

// An end is before its start when its span closes before the start begins; a date end closing exactly there covers only earlier days.
function reversed(start: string, end: string, timezone: string): boolean {
  const compared = Temporal.Instant.compare(bounds(end, timezone).end, bounds(start, timezone).begin);
  return compared < 0 || (compared === 0 && isDate(end));
}

/** A view's evaluated rows with their notes, for the arrangements below. */
export function datedRows(evaluation: { paths: string[]; result: { rows: Data[] } }): DatedRow[] {
  return evaluation.paths.map((path, index) => ({ path, values: evaluation.result.rows[index]! }));
}

/** Place rows, in portable-query order, on the days of their date dimensions (CM-598 to CM-600). */
export function arrangeCalendar(
  rows: DatedRow[],
  dates: Array<{ column: string; label?: string }>,
  options: { timezone: string; backlog?: boolean },
): Calendar {
  const days = new Map<string, CalendarEntry[]>();
  const backlogs: Record<string, string[]> = {};
  for (const { column } of dates) backlogs[column] = [];
  for (const row of rows)
    for (const { column, label } of dates) {
      const value = row.values[column];
      if (value === null || value === undefined) {
        if (options.backlog) backlogs[column]!.push(row.path);
        continue;
      }
      const day = dayOf(String(value), options.timezone);
      days.set(day, [...(days.get(day) ?? []), { path: row.path, column, label: label ?? column }]);
    }
  return {
    days: [...days.keys()].sort(Temporal.PlainDate.compare).map((day) => ({ day, entries: days.get(day)! })),
    backlogs: options.backlog ? backlogs : {},
  };
}

/** Draw rows, in portable-query order, as spans from start to end (CM-602 to CM-604). */
export function arrangeTimeline(rows: DatedRow[], timeline: { start: string; end?: string }, options: { timezone: string; backlog?: boolean }): Timeline {
  const spans: TimelineSpan[] = [];
  const backlog: string[] = [];
  for (const row of rows) {
    const start = row.values[timeline.start];
    if (start === null || start === undefined) {
      if (options.backlog) backlog.push(row.path);
      continue;
    }
    const from = bounds(String(start), options.timezone);
    const end = timeline.end === undefined ? null : row.values[timeline.end];
    // A missing or reversed end leaves a span covering only the start (CM-603).
    const until =
      end === null || end === undefined || reversed(String(start), String(end), options.timezone) ? from.end : bounds(String(end), options.timezone).end;
    spans.push({ path: row.path, start: from.begin.toString(), end: until.toString() });
  }
  return { spans, backlog };
}

/** The stored value moved to another day, keeping a datetime's wall-clock time and form (CM-608). */
export function moveDate(value: string, day: string, timezone: string): string {
  const target = Temporal.PlainDate.from(day);
  if (isDate(value)) return target.toString();
  const [, time, suffix = ""] = /^[^T]+T([^Z+-]+(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})?$/i.exec(value) ?? [];
  const floating = suffix === "";
  const wall = zoned(value, timezone).toPlainTime();
  let moved: Temporal.ZonedDateTime;
  try {
    moved = target.toPlainDateTime(wall).toZonedDateTime(timezone, { disambiguation: "reject" });
  } catch {
    throw new DateMoveError("CM-608", `${target}T${wall} is skipped or repeated in ${timezone}`);
  }
  if (floating) return `${target}T${time}`;
  // Keep the stored precision: minutes, seconds, or as many fractional digits.
  const digits = (time!.split(".")[1] ?? "").length as Temporal.ToStringPrecisionOptions["fractionalSecondDigits"];
  const precision: Temporal.ToStringPrecisionOptions = time!.split(":").length === 2 ? { smallestUnit: "minute" } : { fractionalSecondDigits: digits };
  if (suffix.toUpperCase() === "Z") return moved.toInstant().toString(precision);
  return `${moved.toPlainDateTime().toString(precision)}${moved.offset}`;
}

/** The write for dropping a calendar entry on a day, or on the backlog when day is null (CM-606). */
export function calendarMove(field: string, value: string | null, day: string | null, timezone: string): DateWrite {
  if (day === null) return { kind: "unset_field", field };
  return { kind: "set_field", field, value: value === null ? Temporal.PlainDate.from(day).toString() : moveDate(value, day, timezone) };
}

/** The writes for shifting a span, resizing one endpoint, or sending a row to the backlog (CM-607). */
export function timelineMove(
  fields: { start: string; end?: string },
  values: { start: string | null; end?: string | null },
  move: { kind: "shift"; day: string } | { kind: "resize"; endpoint: "start" | "end"; day: string } | { kind: "backlog" },
  timezone: string,
): DateWrite[] {
  if (move.kind === "backlog") return [{ kind: "unset_field", field: fields.start }];
  const end = values.end ?? null;
  if (move.kind === "shift") {
    if (values.start === null) return [{ kind: "set_field", field: fields.start, value: Temporal.PlainDate.from(move.day).toString() }];
    const days = Temporal.PlainDate.from(dayOf(values.start, timezone)).until(Temporal.PlainDate.from(move.day)).days;
    const shift = (value: string) => moveDate(value, Temporal.PlainDate.from(dayOf(value, timezone)).add({ days }).toString(), timezone);
    const writes: DateWrite[] = [{ kind: "set_field", field: fields.start, value: shift(values.start) }];
    if (fields.end !== undefined && end !== null) writes.push({ kind: "set_field", field: fields.end, value: shift(end) });
    return writes;
  }
  const field = move.endpoint === "start" ? fields.start : fields.end;
  if (field === undefined) throw new DateMoveError("CM-607", "The timeline has no end column");
  const current = move.endpoint === "start" ? values.start : end;
  const value = current === null ? Temporal.PlainDate.from(move.day).toString() : moveDate(current, move.day, timezone);
  const start = move.endpoint === "start" ? value : values.start;
  const finish = move.endpoint === "end" ? value : end;
  if (start !== null && finish !== null && reversed(start, finish, timezone))
    throw new DateMoveError("CM-607", "A resize cannot place the end before the start");
  return [{ kind: "set_field", field, value }];
}
