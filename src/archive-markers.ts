import { matchesFrontmatterPredicates } from "./conditions";
import { fullPattern } from "./field-values";

type Data = Record<string, any>;

export const ARCHIVE_MARKERS = "typedmark:archive-markers";

/** Markers apply only when the collection declares the extension at the version this tool implements (ARC-3). */
export function archiveMarkersApply(config: Data): boolean {
  return config?.extensions?.[ARCHIVE_MARKERS] === "0.1.0" && Array.isArray(config.archive_markers) && config.archive_markers.length > 0;
}

/** One `when` block against the note's path and stored frontmatter, as a `kind: fixed` mapping reads it (ARC-4, ARC-5). */
export function matchesWhenBlock(when: Data, path: string, stored: Data, hasFrontmatter: boolean): boolean {
  path = path.normalize("NFC");
  if (when.path?.equals !== undefined && path !== String(when.path.equals).normalize("NFC")) return false;
  if (when.path?.under !== undefined && !path.startsWith(String(when.path.under).normalize("NFC"))) return false;
  if (when.path?.regex !== undefined && !fullPattern(when.path.regex).test(path)) return false;
  if (when.frontmatter && (!hasFrontmatter || !matchesFrontmatterPredicates(when.frontmatter, stored))) return false;
  return true;
}

/**
 * The archived state that markers give a note at `path` with `stored`
 * frontmatter (ARC-6), or undefined when markers do not apply or the note
 * stores `archived`, which takes precedence (ARC-7).
 */
export function markerArchived(config: Data, path: string, stored: Data, hasFrontmatter = true): boolean | undefined {
  if (!archiveMarkersApply(config) || Object.hasOwn(stored ?? {}, "archived")) return undefined;
  return (config.archive_markers as Data[]).some((when) => when && typeof when === "object" && matchesWhenBlock(when, path, stored ?? {}, hasFrontmatter));
}
