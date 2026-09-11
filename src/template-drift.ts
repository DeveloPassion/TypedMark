import { createHash } from "node:crypto";

export function regionDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content.replace(/\r\n?/g, "\n"), "utf8").digest("hex")}`;
}

/** Structural receipt/marker checks precede this three-way digest comparison. */
export function classifyRegion(baseline: string | undefined, note: string | undefined, template: string | undefined) {
  if (note === undefined && template === undefined) return "retired";
  if (note === template) return "current";
  if (baseline === undefined) return "template_added";
  if (note === undefined) return "region_missing";
  if (template === undefined) return note === baseline ? "template_removed" : "template_removed_note_changed";
  if (note === baseline) return "template_changed";
  if (template === baseline) return "note_changed";
  return "both_changed";
}
