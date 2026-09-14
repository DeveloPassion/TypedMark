# Physical body-link source spans

Status: accepted on 2026-09-14. Supersedes the physical-span limitation and
secondary HTML block parsing in [decision 003](003-note-link-source-preservation.md).
The later extraction-only lexer in [decision 008](008-extraction-only-inline-lexer.md)
supersedes emphasis-tree traversal and masking without changing the source-span contract.

## Contract

`extractBodyLinks(body)` retains the existing logical parser `raw` and parsed
components, and adds `source: { start, end, raw }`. Positions are zero-based
UTF-16 offsets into the exact supplied body, with an exclusive end. The source
string equals `body.slice(start, end)`. A multiline link's physical span includes
original line endings and any intervening quote/list prefixes; those prefixes
do not become part of the logical link label or target.

These are body-relative string positions, not file-byte positions. Collection
models now preserve original body line endings, including when note frontmatter
is malformed. Template reading already did so. Global `parseMarkdown` defaults
remain unchanged. No source files are rewritten and no backlink writer is implied.

## Source-aware block parsing

CommonMark 0.31.2 supplies the original block structure. A bounded adapter captures
the source line and offset during `addLine`, including partially consumed tabs.
A weak map keyed by the actual `sourcepos` array survives setext node replacement.
Reference-prefix removals are checked suffix slices, including removal before
further paragraph content is appended. ATX headings are mapped from their actual
line/column and opening marker. Structural API and source-shape guards fail
operationally if the pinned parser seam changes.

The adapter skips original code blocks and retains paragraph, heading and HTML
source. Logical line endings/container indentation follow block parsing. Original
NUL characters are restored for the shared direct/body link parser rather than
silently changing link components through block-parser preprocessing. Physical
spans retain all original characters.

Sources:

- [Pinned block parsing and source positions](https://github.com/commonmark/commonmark.js/blob/0.31.2/lib/blocks.js)
- [Pinned inline-source trimming](https://github.com/commonmark/commonmark.js/blob/0.31.2/lib/inlines.js)
- [TypedMark block baseline](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/foundations.md#markdown-baseline)

## Inline extraction and corrected exclusions

Marked consumes the retained logical source. Token lengths map directly to the
captured positions; unchanged emphasis/label child tokens are reused instead of
re-lexing their subtrees. Labels whose text was normalized by Marked are re-lexed
from their authored slice, preserving escapes. This removes phantom links that
previously appeared only after escaped brackets were unescaped inside labels.

HTML content receives inline extraction, not another block parse. Consequently,
reference-looking text or indentation inside a continuing HTML block does not
invent new exclusions. Original CommonMark code blocks and balanced inline code
spans remain excluded. Governed marker metadata is omitted while its source
offsets are retained for following content. Reference-style outer link support
is not added by this decision.

The existing isolated HTML mask override remains; it never mutates shared rules.
The implementation also reuses already parsed subtrees and preserves frame
identity when marker filtering changes nothing. A reproduced 320-level emphasis
case dropped from roughly 4.8 seconds to 57 milliseconds. Regression guards cover
that case, ordinary marker-like comments, and large HTML input.

## Verification and remaining work

Regressions cover LF/CRLF/CR, Unicode offsets, tabs, ATX/setext/reference contexts,
HTML, metadata/code/escaped decoys, nested images and overlapping spans. Independent
review checked 5,000 generated bodies, 11,783 maps and 12,667 extracted spans,
plus all 652 official CommonMark examples and 652 link-injected variants.

Physical source preservation does not certify every link contract. RFC 3986
destination validation, malformed-percent diagnostics and the pending encoded-anchor
interpretation decision remain separate audit work. Markdown entity processing
was subsequently corrected in [decision 005](005-markdown-destination-decoding.md).
