# Markdown anchor encoding

Status: implementation of the maintainer's anchor-encoding decision, 2026-09-15.

## Decision and boundaries

The maintainer chose RFC 3986 percent encoding for Markdown anchors, retaining
one leading `^` as the TypedMark block marker. The specification records this in
NL-6: Markdown link destinations satisfy RFC 3986 encoding before percent
decoding, except for an anchor's leading `^`. This resolves the raw-fragment
character-validation conflict that
[decision 016](016-unicode-note-link-components.md) left open. NL-6 is
clarified, not relaxed; no new artifact shape or rule ID is introduced.

The check applies only to Markdown anchors. Wikilink anchors stay literal, URI
fields keep their separate `URI` grammar under FDR-140, and pre-fragment
Markdown targets keep the existing [URI syntax checks](007-rfc-uri-syntax.md).
Reference-style outer links and other Markdown consumers remain separate work.

## Interface

`interpretNoteLinkAnchor` checks the anchor against RFC 3986's `fragment`
production after CommonMark escape/entity processing and before the single
strict UTF-8 percent-decoding pass described in decision 016. Only one leading
literal caret is exempt; an encoded caret (`%5E`) still marks a block because it
decodes before interpretation, while a second or later raw caret is rejected.

| Authored Markdown anchor | Result |
| --- | --- |
| `Caf%C3%A9` | heading `Café` |
| `^part` | block `part` |
| `%5Epart` | block `part` |
| `Café`, `Heading text`, `Head|Tail` | `invalid_note_link` (NL-6) |
| `^^part`, `Head^Tail` | `invalid_note_link` (NL-6) |
| `%FF` | `invalid_note_link` (NL-11) |

`parseNoteLink` and body inspection reject such links with located failures, as
for other NL-6 findings. Rejected links create no relationship instances, and
query blocking survives diagnostic suppression. Authored `anchor`, `raw` and
physical source spans are unchanged for accepted links.

## Migration

Collections with raw Unicode, spaces or forbidden punctuation in Markdown
anchors must percent-encode those characters as UTF-8, preserving existing valid
triplets; see the specification's `migration-0.1.md`. The validator reports but
never rewrites them.

## Verification

A dedicated 44-case suite covers rejected raw characters, accepted encoded and
RFC-allowed characters, caret placement, entity/escape interaction, absent
anchors and physical multiline spans. Three golden vectors distinguish valid,
invalid and suppressed models, with one additional query case.

Sources: [NL-6](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-links.md#link-forms),
[RFC 3986 fragment](https://www.rfc-editor.org/rfc/rfc3986#section-3.5),
and [CommonMark escapes/entities](https://spec.commonmark.org/0.31.2/#entity-and-numeric-character-references).
