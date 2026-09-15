# Text input boundaries

Status: accepted on 2026-09-15 (Europe/Brussels).

## Observed mismatches

The fixture checker rejected valid CR-only frontmatter while the runtime accepted
it. It also replacement-decoded malformed UTF-8, accepting corrupted bytes even in
governed artifact bodies and JSON string values. The runtime rejected those bytes.
An actual UTF-8 U+FFFD replacement character was valid in both implementations.

Review of the same boundary found two related mismatches. The checker's optional
frontmatter path accepted a YAML set because its syntax node looked like a mapping,
despite materializing a native Set. Separately, runtime byte input consumed two
leading BOMs: TextDecoder removed one and the parser removed another. Text input
consumed only one. This could expose a delimiter that was not actually the first line.

## Decision

All existing checker text-file reads use fatal UTF-8 decoding. The decoder preserves
the BOM so each caller retains its own behavior: Markdown's grammar removes one,
while JSON.parse keeps its existing BOM rejection. The change covers schemas,
artifact fixtures, specification examples and golden inputs without changing
discovery. Non-Markdown binary assets remain outside these reads.

Frontmatter uses CR, LF and CRLF line boundaries and verifies a plain or
null-prototype mapping after YAML materialization. Empty/comment-only mappings,
optional missing/unclosed blocks and later body delimiters retain their existing
handling. Nested opaque tagged values are not banned or normalized.

The runtime decoder likewise retains the BOM for one removal at the grammar layer.
Byte and text inputs now agree, including doubled/tripled BOMs and interior BOM
content. Decoding and validation never rewrite source bytes. Filesystem read errors
remain distinct from malformed-encoding errors.

## Verification and boundary

Thirty checker regressions cover line endings, BOMs, exact delimiters, optional
frontmatter, native tags, malformed byte sequences, JSON input, binary assets and
byte preservation. Fifteen runtime cases cover byte/text BOM parity, interior
content, real replacement characters and collection configuration validation.
The original three-case checker/runtime probe now agrees on every outcome.

These are input-boundary corrections under the existing Foundations rules. They
do not change artifact shapes, extension interpretation, fixture discovery,
validation target scope or the JSON BOM policy. The fixture integrity checker
does not become a semantic conformance runner merely by rejecting corrupt input.

Sources:

- [Foundations parsing baselines](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/foundations.md#parsing-and-matching-baselines)
- [TextDecoder fatal and ignoreBOM options](https://nodejs.org/api/util.html#new-textdecoderencoding-options)
- [YAML document materialization](https://eemeli.org/yaml/#parsing-documents)
