# Preserve terminal YAML content newlines

Status: accepted implementation decision on 2026-09-15 (Europe/Brussels).

## Problem

Both frontmatter readers split Markdown into lines, selected the YAML lines,
then joined them with newlines. Joining omitted the content line break before
the closing delimiter. A final keep-chomp scalar therefore lost one newline:
`retained\n\n` became `retained\n`. The same loss occurred in the fixture checker's
classified YAML examples because Marked's fence token omits the final content
newline. A valid note could fail a length/constant constraint, or an invalid
constant match could be incorrectly accepted.

The scaffold serializer separately trimmed the end of YAML.stringify output.
That also removed significant keep-chomp scalar content. A passing target report
did not prove value preservation when no constraint exposed the shortened value.
Review additionally reproduced loss of spaces from all-blank multiline scaffold
values, even after removing that trim, in the library's block-scalar serializer.

## Decision

For a non-empty frontmatter block, retain the final content newline when
reconstructing the normalized YAML input. An empty block remains empty. The exact
opening/closing delimiter grammar, BOM consumption, UTF-8 handling, error wrapper,
alias resource limits and body extraction are unchanged. The shared runtime
parser covers configuration, schemas, notes, templates and the root writer's AST.

For classified YAML/YML fences, restore the content newline excluded by Marked
18.0.5's fence capture before parsing. This applies equally to full artifacts and
syntax-checked fragments. JSON and Markdown example handling remain separate;
unclosed fences are still rejected. No scalar post-processing guesses which
chomping style was used: YAML itself determines keep, clip and strip behavior.

Scaffold serialization now quotes multiline strings, retains YAML.stringify's
complete output and writes the Markdown closer on the following line. Quoting
also preserves spaces in otherwise blank lines; it matches the root writer's
existing strategy. Artifact/note bodies are appended unchanged.
The root writer's prior keep-chomp test counted the parser's lost newline; its expected value
now includes all four physical YAML content newlines in that fixture.

## Verification and limits

Reader/checker regressions cover LF/CRLF/CR, both exact closing delimiters,
literal/folded styles, nested and empty scalars, EOF closers, byte/text input,
BOMs, unchanged bodies and source bytes. A collection regression checks length;
an import regression checks exact root and scaffold values. Two golden vectors
distinguish correct and incorrect constant matches by one trailing newline.
Explicit scaffold-space regressions reproduce the review finding, and independent
review checked 1,464 strings, including nested values, with the quoted strategy
and unchanged bodies.

This corrects the existing Foundations grammar, not a new artifact shape or
version policy. It does not resolve the shared-root alias-budget operability
limit documented in decision 014, or establish general native-tag/precision
fidelity for the separate scaffold materializer. Those remain in the plan audit.

Sources:

- [TypedMark frontmatter grammar](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/foundations.md#frontmatter-block-grammar)
- [YAML 1.2.2 block chomping](https://yaml.org/spec/1.2.2/#8112-block-chomping-indicator)
- [Marked 18.0.5 fence grammar](https://github.com/markedjs/marked/blob/v18.0.5/src/rules.ts)
