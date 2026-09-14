import { decodeHTMLStrict } from "entities";

// CommonMark permits only semicolon-terminated entities and escaped ASCII
// punctuation. Processing both in one pass preserves escaped ampersands.
// https://spec.commonmark.org/0.31.2/#entity-and-numeric-character-references
// https://spec.commonmark.org/0.31.2/#backslash-escapes
const entityOrEscape = /\\[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/gu;

/** Markdown processing only: the returned URI/target are not percent-decoded. */
export function markdownLinkDestination(authored: string): { uri: string; target: string; anchor?: string } {
  const parts: string[] = [];
  let cursor = 0, anchorStart: number | undefined;
  const append = (value: string, start: number, entityEnd?: number): void => {
    if (anchorStart === undefined) {
      const hash = value.indexOf("#");
      if (hash >= 0) anchorStart = entityEnd ?? start + hash + 1;
    }
    parts.push(value);
  };
  for (const match of authored.matchAll(entityOrEscape)) {
    append(authored.slice(cursor, match.index), cursor);
    cursor = match.index + match[0].length;
    const decoded = match[0].startsWith("\\") ? match[0].slice(1) : decodeReference(match[0]);
    append(decoded, match.index, cursor);
  }
  append(authored.slice(cursor), cursor);
  const uri = parts.join("");
  const hash = uri.indexOf("#");
  // Map the semantic separator back to its authored end. A numeric entity's
  // own '#' is not a separator, while &#35; contributes one whole separator.
  return { uri, target: hash < 0 ? uri : uri.slice(0, hash),
    ...(anchorStart === undefined ? {} : { anchor: authored.slice(anchorStart) }) };
}

function decodeReference(reference: string): string {
  if (!reference.startsWith("&#")) return decodeHTMLStrict(reference);
  // The grammar above bounds digits. CommonMark names Unicode scalars directly;
  // HTML decoders additionally remap C1 values through Windows-1252, which would
  // change a note target (for example, &#128; would incorrectly become '€').
  const hexadecimal = reference[2] === "x" || reference[2] === "X";
  const code = Number.parseInt(reference.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
  return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
    ? "\uFFFD" : String.fromCodePoint(code);
}
