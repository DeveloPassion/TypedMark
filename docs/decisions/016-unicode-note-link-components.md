# Unicode note-link components and URI fragments

Status: implementation of the maintainer's decoding/URI decisions, 2026-09-15.

## Decisions and boundaries

The maintainer selected decoded Markdown-anchor interpretation, rejection of
non-UTF-8 internal note targets, and continued fragment support for URI fields.
The specification records the decoding contract in NL-11 and clarifies FDR-140
as RFC 3986's `URI` grammar, not its fragment-free `absolute-URI` production.
UTF-8 decoding applies to Markdown anchors as well as targets. Wikilinks stay
literal, and ordinary URI fields retain RFC 3986's arbitrary encoded octets.

These decisions resolve the corresponding open questions in decisions
[005](005-markdown-destination-decoding.md),
[006](006-note-link-diagnostics.md), [007](007-rfc-uri-syntax.md), and
[008](008-extraction-only-inline-lexer.md). They do not resolve the separate
raw-fragment character-validation conflict: NL-6 remains unchanged, while the
existing parser is permissive for some raw anchor characters. A maintainer
question explicitly asks whether to enforce RFC encoding there. This increment
does not silently relax that normative rule or claim exhaustive URI conformance.

## Source-preserving interface

`parseNoteLink` and body inspection retain their existing successful result
shapes. `anchor` stays authored text; `raw` and physical body spans are unchanged.
The additive `interpretNoteLinkAnchor` helper returns `{kind, value}`, or
`undefined` for an absent anchor. An explicitly empty anchor is an empty heading.
Block values omit the initial caret; the helper does not look up a heading or
block in a target note and does not define asset-anchor semantics.

| Form / authored anchor | Interpretation |
| --- | --- |
| Markdown `%5Epart` | block `part` |
| Markdown `%255Epart` | heading `%5Epart` |
| Markdown `Head%20text` | heading `Head text` |
| Wikilink `%5Epart` | heading `%5Epart` |

Markdown escape/entity processing occurs once, followed by one strict UTF-8
percent-decoding pass. A plus sign is not a form-encoded space. Decoded data is
not rescanned for entities, percent escapes, or a new target/fragment delimiter.

Malformed percent triplets retain NL-6 diagnostics. Well-formed octets that
cannot decode as UTF-8 produce `invalid_note_link` under NL-11 rather than
silently disappearing from body inspection. Located failures, graph exclusion,
independent neighboring links and query blocking survive diagnostic suppression.
External Markdown schemes are still excluded before internal-link decoding.

## Verification

The baseline exposed 43 failures in the original 52-case reproduction. The
final focused suite has 54 passing cases, including Unicode boundaries, lexical
source retention, one-pass decoding, wiki controls, URI fragments, and separate
error/warn/off query checks. Three golden vectors distinguish valid, invalid,
and suppressed internal-link models without changing source bytes.

Sources: [NL-11](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-links.md#link-parsing),
[FDR-140](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/field-definition-reference.md#format),
[ECMAScript decodeURIComponent](https://tc39.es/ecma262/multipage/global-object.html#sec-decodeuricomponent-encodeduricomponent),
[CommonMark escapes/entities](https://spec.commonmark.org/0.31.2/#entity-and-numeric-character-references),
and [RFC 3986 grammar](https://www.rfc-editor.org/rfc/rfc3986#appendix-A).
