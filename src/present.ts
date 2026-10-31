import { Temporal } from "@js-temporal/polyfill";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arrangeCalendar, arrangeTimeline } from "./calendar-views";
import type { CollectionModel } from "./collection-model";
import { compareFieldValues, equalFieldValues, type FieldDefinition } from "./field-values";
import { parseMarkdown } from "./frontmatter";
import { evaluateQueryWithColumns, type Descriptor, type QueryEvaluation } from "./query-engine";
import { SchemaRegistry } from "./schema-registry";
import { viewRollups, viewTree, type RolledNode, type TreeNode } from "./tree-views";
import { readCollectionModel } from "./validator";
import { validateViews } from "./views";

type Data = Record<string, any>;
type Row = Record<string, unknown>;

export class ViewPresentationError extends Error {
  constructor(
    readonly rule_id: string,
    message: string,
  ) {
    super(`${rule_id}: ${message}`);
  }
}

/** One presented row: its note, its item line for item rows, and its presented values. */
export interface PresentedRow {
  path: string;
  line?: number;
  values: Row;
}
export interface PresentedTreeNode extends PresentedRow {
  context: boolean;
  /** Rollup columns whose value came from children (CM-616). */
  derived: string[];
  children: PresentedTreeNode[];
}
export interface BoardColumn {
  label: string;
  value: unknown;
  unmapped: boolean;
  rows: PresentedRow[];
}
export interface Presentation {
  view: string;
  label: string;
  layout: string;
  /** The collection timezone that calendar days and timeline spans use. */
  timezone: string;
  fields: Array<{ column: string; label: string }>;
  rows?: PresentedRow[];
  groups?: Array<{ key: unknown[]; rows: PresentedRow[] }>;
  lanes?: Array<{ label: string; value: unknown; columns: BoardColumn[] }>;
  tree?: PresentedTreeNode[];
  days?: Array<{ day: string; entries: Array<PresentedRow & { dimension: string }> }>;
  spans?: Array<PresentedRow & { start: string; end: string }>;
  backlogs?: Record<string, PresentedRow[]>;
  /** Notes the query left out because their own model could not be resolved (CM-619 to CM-621). */
  skipped?: string[];
}

/**
 * Evaluate and arrange one saved view for display, read-only. The view must
 * validate first; a finding on it is reported instead of a partial view.
 */
export function presentView(collectionRoot: string, schemaDirectory: string, viewId: string): Presentation {
  const model = readCollectionModel({ collectionRoot, schemaDirectory });
  const metadata = typeof model.config.metadata_directory === "string" ? model.config.metadata_directory : ".typedmark";
  const views = validateViews(collectionRoot, metadata, model, new SchemaRegistry(schemaDirectory));
  const path = `${metadata}/views/${viewId}.md`;
  const finding = views.results.find((result) => result.severity === "error" && result.path === path);
  if (finding) throw new ViewPresentationError(finding.rule_id, finding.message);
  const source = views.sources.get(`view:${viewId}`);
  if (!source) throw new ViewPresentationError("CM-409", `No saved view ${viewId}`);
  if (source.error) throw new ViewPresentationError(source.error.rule_id, source.error.message);
  if (!source.evaluation || !source.query) throw new ViewPresentationError("CM-421", `View ${viewId} could not be evaluated`);
  const data = parseMarkdown(readFileSync(join(collectionRoot, path))).data as Data;
  return arrange(model, data, source.query, source.evaluation);
}

function arrange(model: CollectionModel, data: Data, query: Descriptor, evaluation: QueryEvaluation): Presentation {
  const presentation = data.presentation as Data;
  const timezone = model.config.timezone ?? "UTC";
  // Display names are labels, or the column alias (CM-417, CM-427).
  const fields = (presentation.fields as Data[]).map((field) => ({ column: field.column as string, label: (field.label as string) ?? field.column }));
  const presented = (values: Row): Row => Object.fromEntries(fields.map(({ column }) => [column, values[column] ?? null]));
  const rows: PresentedRow[] = evaluation.result.rows.map((values, index) => ({
    path: evaluation.paths[index]!,
    ...(evaluation.lines ? { line: evaluation.lines[index] } : {}),
    values: presented(values),
  }));
  const base: Presentation = {
    view: data.view,
    label: data.label ?? data.view,
    layout: presentation.layout,
    timezone,
    fields,
    ...(evaluation.result.skipped ? { skipped: evaluation.result.skipped } : {}),
  };
  // Calendar and timeline placement keys rows by index, so item rows of one note stay distinct.
  const dated = evaluation.result.rows.map((values, index) => ({ path: String(index), values }));
  const byPath = new Map<string, PresentedRow>();
  for (const row of rows) if (!byPath.has(row.path)) byPath.set(row.path, row);

  switch (presentation.layout) {
    case "board":
      return { ...base, lanes: arrangeBoard(rows, evaluation, presentation.board, timezone) };
    case "tree": {
      const tree = presentation.tree as Data;
      const forest = viewTree(model, query, evaluation, { parent: tree.parent, context: tree.context });
      const rolled = tree.rollups ? viewRollups(model, query, evaluation, forest, tree.rollups) : undefined;
      // A context row presents the view's projections evaluated on its own note (CM-592).
      const context = (path: string): Row => {
        try {
          const single = evaluateQueryWithColumns(model, {
            specification_version: query.specification_version,
            where: { kind: "path", operator: "equals", value: path },
            select: query.select,
          } as Descriptor);
          return presented(single.result.rows[0] ?? {});
        } catch {
          return presented({ path });
        }
      };
      const node = (tree: TreeNode | RolledNode): PresentedTreeNode => {
        const values = tree.context ? context(tree.path) : { ...byPath.get(tree.path)!.values };
        const derived: string[] = [];
        for (const [column, rollup] of Object.entries((tree as RolledNode).values ?? {})) {
          values[column] = rollup.value;
          if (rollup.derived) derived.push(column);
        }
        return { path: tree.path, values, context: tree.context, derived, children: tree.children.map(node) };
      };
      return { ...base, tree: (rolled ?? forest).map(node) };
    }
    case "calendar": {
      const calendar = presentation.calendar as Data;
      const arranged = arrangeCalendar(dated, calendar.dates, { timezone, backlog: calendar.backlog === true });
      return {
        ...base,
        days: arranged.days.map(({ day, entries }) => ({ day, entries: entries.map((entry) => ({ ...rows[Number(entry.path)]!, dimension: entry.label })) })),
        backlogs: Object.fromEntries(Object.entries(arranged.backlogs).map(([column, keys]) => [column, keys.map((key) => rows[Number(key)]!)])),
      };
    }
    case "timeline": {
      const timeline = presentation.timeline as Data;
      const arranged = arrangeTimeline(dated, { start: timeline.start, end: timeline.end }, { timezone, backlog: timeline.backlog === true });
      return {
        ...base,
        spans: arranged.spans.map((span) => ({ ...rows[Number(span.path)]!, start: span.start, end: span.end })),
        backlogs: timeline.backlog === true ? { [timeline.start]: arranged.backlog.map((key) => rows[Number(key)]!) } : {},
      };
    }
    default: {
      // Tables, lists and cards keep query groups as ordered sections (CM-429 to CM-432).
      if (!evaluation.result.groups) return { ...base, rows };
      const position = new Map(evaluation.result.rows.map((row, index) => [row, index]));
      return { ...base, rows, groups: evaluation.result.groups.map((group) => ({ key: group.key, rows: group.rows.map((row) => rows[position.get(row)!]!) })) };
    }
  }
}

/** Partition rows into lanes and declared columns, then an unmapped column, ordered by rank (CM-434, CM-439 to CM-444, CM-568 to CM-572, CM-578). */
export function arrangeBoard(
  rows: PresentedRow[],
  evaluation: QueryEvaluation,
  board: Data,
  timezone: string,
): Array<{ label: string; value: unknown; columns: BoardColumn[] }> {
  const definition = (index: number, column: string): FieldDefinition => evaluation.rowDefinitions[index]?.[column] ?? { type: "text" };
  const raw = (index: number, column: string) => evaluation.result.rows[index]![column] ?? null;
  const indexes = rows.map((_, index) => index);
  // Lanes: distinct non-null values ascending, then one null lane (CM-570, CM-571).
  const laneColumn = board.lanes?.column as string | undefined;
  const laneValues: Array<{ value: unknown; index: number }> = [];
  if (laneColumn)
    for (const index of indexes) {
      const value = raw(index, laneColumn);
      if (value !== null && !laneValues.some((lane) => equalFieldValues(lane.value, value, definition(index, laneColumn), timezone)))
        laneValues.push({ value, index });
    }
  laneValues.sort((left, right) => compareFieldValues(left.value, right.value, definition(left.index, laneColumn!), timezone));
  const lanes: Array<{ label: string; value: unknown; members: number[] }> = laneColumn
    ? laneValues.map(({ value }) => ({
        label: String(value),
        value,
        members: indexes.filter((index) => {
          const own = raw(index, laneColumn);
          return own !== null && equalFieldValues(own, value, definition(index, laneColumn), timezone);
        }),
      }))
    : [{ label: "", value: null, members: indexes }];
  const nulls = laneColumn ? indexes.filter((index) => raw(index, laneColumn) === null) : [];
  if (nulls.length) lanes.push({ label: board.lanes.empty_label ?? "None", value: null, members: nulls });

  const rank = board.rank as string | undefined;
  const ranked = (members: number[]) =>
    rank === undefined
      ? members
      : [...members].sort((left, right) => {
          const a = raw(left, rank);
          const b = raw(right, rank);
          if (a === null || b === null) return a === null && b === null ? left - right : a === null ? 1 : -1;
          return (a as number) - (b as number) || left - right;
        });
  return lanes.map((lane) => {
    const placed = new Set<number>();
    const columns: BoardColumn[] = (board.columns as Data[]).map((declared) => {
      const members = lane.members.filter((index) => {
        const value = raw(index, board.column);
        const match =
          value === null
            ? declared.value === null
            : declared.value !== null && equalFieldValues(value, declared.value, definition(index, board.column), timezone);
        if (match) placed.add(index);
        return match;
      });
      return { label: declared.label ?? String(declared.value), value: declared.value, unmapped: false, rows: ranked(members).map((index) => rows[index]!) };
    });
    const unmapped = lane.members.filter((index) => !placed.has(index));
    if (unmapped.length)
      columns.push({ label: board.unmapped_label ?? "Other", value: null, unmapped: true, rows: ranked(unmapped).map((index) => rows[index]!) });
    return { label: lane.label, value: lane.value, columns };
  });
}

const show = (value: unknown): string =>
  value === null || value === undefined
    ? ""
    : Array.isArray(value)
      ? value.map(show).join(", ")
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

// Whole-day spans read as inclusive days; other spans as local times in the collection timezone.
function spanText(start: string, end: string, timezone: string): string {
  const local = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
  const from = local(start);
  const until = local(end);
  const midnight = (value: Temporal.ZonedDateTime) => value.toPlainTime().equals(Temporal.PlainTime.from("00:00"));
  if (midnight(from) && midnight(until) && Temporal.ZonedDateTime.compare(from, until) < 0) {
    const last = until.toPlainDate().subtract({ days: 1 });
    return last.equals(from.toPlainDate()) ? from.toPlainDate().toString() : `${from.toPlainDate()} → ${last}`;
  }
  const text = (value: Temporal.ZonedDateTime) => `${value.toPlainDate()} ${value.toPlainTime().toString({ smallestUnit: "minute" })}`;
  return start === end ? text(from) : `${text(from)} → ${text(until)}`;
}

/** A plain-text rendering of a presentation for terminals. */
export function renderPresentation(presentation: Presentation): string {
  const [primary, ...secondary] = presentation.fields;
  const line = (row: PresentedRow, marks: string[] = []) => {
    const rest = secondary
      .map(({ column, label }) => (show(row.values[column]) ? `${label}: ${show(row.values[column])}${marks.includes(column) ? "*" : ""}` : ""))
      .filter(Boolean);
    const first = show(row.values[primary!.column]);
    return [first ? `${first}${marks.includes(primary!.column) ? "*" : ""}` : row.path, ...rest].join("  ·  ");
  };
  const out: string[] = [`${presentation.label} (${presentation.layout})`, ""];
  const section = (title: string, rows: PresentedRow[]) => out.push(`## ${title}`, ...rows.map((row) => `- ${line(row)}`), "");
  switch (presentation.layout) {
    case "table": {
      const header = presentation.fields.map((field) => field.label);
      const body = presentation.rows!.map((row) => presentation.fields.map(({ column }) => show(row.values[column])));
      const widths = header.map((cell, index) => Math.max(cell.length, ...body.map((cells) => cells[index]!.length)));
      const format = (cells: string[]) =>
        cells
          .map((cell, index) => cell.padEnd(widths[index]!))
          .join("  ")
          .trimEnd();
      out.push(format(header), widths.map((width) => "-".repeat(width)).join("  "), ...body.map(format));
      break;
    }
    case "board":
      for (const lane of presentation.lanes!) {
        if (presentation.lanes!.length > 1 || lane.label) out.push(`# ${lane.label}`, "");
        for (const column of lane.columns) section(`${column.label} (${column.rows.length})`, column.rows);
      }
      break;
    case "tree": {
      const walk = (nodes: PresentedTreeNode[], depth: number) => {
        for (const node of nodes) {
          out.push(`${"  ".repeat(depth)}- ${line(node, node.derived)}${node.context ? "  (context)" : ""}`);
          walk(node.children, depth + 1);
        }
      };
      walk(presentation.tree!, 0);
      break;
    }
    case "calendar":
      for (const { day, entries } of presentation.days!) out.push(`## ${day}`, ...entries.map((entry) => `- [${entry.dimension}] ${line(entry)}`), "");
      for (const [column, rows] of Object.entries(presentation.backlogs ?? {})) section(`Backlog: ${column}`, rows);
      break;
    case "timeline":
      for (const span of presentation.spans!) out.push(`- ${spanText(span.start, span.end, presentation.timezone)}  ${line(span)}`);
      if (Object.values(presentation.backlogs ?? {}).some((rows) => rows.length)) out.push("");
      for (const rows of Object.values(presentation.backlogs ?? {})) if (rows.length) section("Backlog", rows);
      break;
    default:
      if (presentation.groups) for (const group of presentation.groups) section(group.key.map(show).join(" / ") || "(none)", group.rows);
      // A card is a block of its fields; a list entry is one line (CM-430, CM-431).
      else if (presentation.layout === "cards")
        for (const row of presentation.rows!) out.push(...presentation.fields.map(({ column, label }) => `${label}: ${show(row.values[column])}`), "");
      else out.push(...presentation.rows!.map((row) => `- ${line(row)}`));
  }
  // Say how many notes were left out rather than hiding them (CM-621).
  if (presentation.skipped?.length)
    out.push("", `${presentation.skipped.length} note${presentation.skipped.length === 1 ? "" : "s"} left out: ${presentation.skipped.join(", ")}`);
  return `${out.join("\n").trimEnd()}\n`;
}
