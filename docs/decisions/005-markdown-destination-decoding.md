# Markdown destination decoding

Status: accepted on 2026-09-14. Supersedes the processed-`href` target source in
[decision 003](003-note-link-source-preservation.md); physical source spans from
[decision 004](004-body-link-source-spans.md) are unchanged.

## Processing boundary

Marked still recognizes complete inline link/image syntax and supplies guarded
authored destination/label captures. CommonMark URI/email autolinks remain
external. The small destination adapter processes CommonMark backslash escapes
and semicolon-terminated character references in a single, nonrecursive pass.
It classifies ASCII URI schemes and separates the fragment before one percent-decoding
pass on the target. It never renders HTML, normalizes a URL or rewrites a file.

This fixes both missing note targets and false relationships: `N&#46;md` names
`N.md`, while `https&#58;//example.com` is external even if a note named
`https&.md` exists. `N%23draft.md` keeps its decoded hash in the target rather
than inventing a fragment. Escaped ampersands and percent-encoded entity-looking
text are not decoded again. Wikilink spelling remains literal.

The public optional parser result, authored `raw`/`displayText`/`anchor`, resolver
inputs and physical body spans are preserved. The first semantic hash maps back
to the end of its authored source spelling: `N.md&#35;Head&amp;Tail` has target
`N.md` and lexical anchor `Head&amp;Tail`. The hash inside `&#46;` does not start
a fragment. Missing anchors stay absent and explicit empty anchors stay empty.

## Character reference implementation

The named-entity decoder is a direct exact pin of `entities@3.0.1`, already
present through CommonMark; the resolved package set does not grow. Its public
`decodeHTMLStrict` API provides the HTML5 name table (BSD-2-Clause).

Numeric references are decoded separately with CommonMark's bounded digit
grammar. They name Unicode scalar values; zero, surrogates and out-of-range
values become U+FFFD. HTML's additional Windows-1252 C1 remapping is deliberately
not used. Independent review caught that shared decoder behavior before commit;
regressions cover every U+0080–U+009F reference in decimal and hexadecimal.
The reviewer also checked 57,617 numeric boundary cases and all 2,125 named
references against the WHATWG table. Explicit ASCII scheme classes avoid the
different Unicode case-folding behavior observed in Node and Bun.

Sources:

- [CommonMark character references](https://spec.commonmark.org/0.31.2/#entity-and-numeric-character-references)
- [CommonMark backslash escapes](https://spec.commonmark.org/0.31.2/#backslash-escapes)
- [CommonMark links](https://spec.commonmark.org/0.31.2/#links)
- [RFC 3986 component and percent-decoding order](https://www.rfc-editor.org/rfc/rfc3986#section-2.4)
- [TypedMark parsing and resolution owner](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-links.md)

## Remaining boundary

This decoding correction does not yet implement RFC 3986 target-spelling
validation or retain malformed-percent destinations as body diagnostics.
Tests of the Markdown-only decoder do not claim its output is a valid URI.
Encoded-anchor interpretation, non-UTF-8 percent-octet handling and reference-style
outer links remain separate audit work. No anchor validation or writer capability
is added here.
