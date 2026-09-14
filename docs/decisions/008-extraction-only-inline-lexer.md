# Extraction-only inline lexing

Status: accepted on 2026-09-15 (Europe/Brussels). Supersedes the inline masking,
extension-start scanning and emphasis-tree traversal described in
[decision 003](003-note-link-source-preservation.md) and
[decision 004](004-body-link-source-spans.md). The physical source-span and
destination-decoding contracts are unchanged.

## Measured problem

Marked 18.0.5 rebuilt its complete emphasis mask for every escaped punctuation
and skipped block. Extension-start callbacks also repeatedly searched the remaining
suffix before plain-text tokens. A valid 600 KB escaped destination took about
17.8 seconds; a link after 600 KB of escaped prose took about 30.1 seconds.

The rendering mask had correctness effects too. Replacing a backslash plus an
astral symbol with two characters shortened UTF-16 coordinates, hiding links,
removing image markers and exposing links inside code. Removing redundant start
callbacks also fixes unmatched-backtick runs that were split into false code spans.

## Decision and scope

Note-link extraction does not need an emphasis rendering tree: emphasis is not
an excluded region under the Note Links contract. The isolated lexer therefore
keeps emphasis delimiters as text and retains the link, image, escape, code-span,
HTML and reference tokenizers. The body walker no longer traverses emphasis nodes.
This is an extraction adapter, not a replacement Markdown renderer.

The adapter suppresses rendering-mask patterns only during the mask phase.
The public `emStrongMask` hook marks the transition to ordinary tokenization;
private per-call state is restored across recursive calls and exceptions. Copied
rule getters expose cloned original patterns outside that phase, preserving
destination/title unescaping and avoiding shared-pattern mutation. A guard checks
that the hook actually ran.

Built-in text boundaries already stop at `[`, `!` and `<`, so the note-link
extensions no longer supply suffix-scanning start callbacks. A small runtime
guard verifies that pinned boundary behavior. Literal HTML handling remains in
the dedicated extraction extension; source characters are never replaced.
No reference definitions are added to the body pipeline and no new reference-style
link capability is claimed.

## Rejected intermediate approach

Linear string replacement improved timings but still coupled extraction to a
rendering mask. Review found that disabling the shared punctuation rule also
disabled URL/title unescaping. Preserving astral mask lengths then exposed another
ordering bug: escape masking could hide a closing backtick whose preceding
backslash was literal code content. The intermediate implementation was not shipped.

The extraction-only adapter avoids those masks entirely. Balanced code spans remain
excluded, including closing backticks preceded by backslashes. Unmatched delimiter
runs stay literal, so subsequent links remain visible. Parsed components and exact
body-relative UTF-16 spans retain the contracts from the earlier decisions.

## Verification and remaining boundary

Twenty-two regressions cover timing, line endings, Unicode, code exclusions,
unmatched backticks, nested images, unescaping and pattern isolation. Two golden
vectors verify the corrected code/extraction boundaries. Review compared 63,778
generated inputs with CommonMark's link/embed results and checked all 652 official
examples; additional HTML, marker, recursion and exception probes found no issues.

On the measured cases, the 600 KB destination fell below 0.1 seconds and escaped
prose below 0.2 seconds. The 480 KB multiline-label and 600 KB code-span cases
completed in about 0.76 and 0.25 seconds. Guards use a generous three-second ceiling,
not a supported-input size limit. A separate scaling probe measured approximately
11/18/32/55 ms for 75/150/300/600 KB escaped destinations.

This addresses the measured masking/start-scan bottlenecks, not every possible
parser performance case. URI-field fragment policy, Markdown anchor interpretation
and non-UTF-8 note-target handling remain unresolved. No source files are rewritten,
and no writer or rendering capability is added.

Sources:

- [TypedMark extraction/exclusion contract](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-links.md#body-link-extraction)
- [CommonMark code spans](https://spec.commonmark.org/0.31.2/#code-spans)
- [Pinned lexer mask and tokenization phases](https://github.com/markedjs/marked/blob/v18.0.5/src/Lexer.ts)
- [Pinned tokenizers](https://github.com/markedjs/marked/blob/v18.0.5/src/Tokenizer.ts)
- [Marked hooks](https://marked.js.org/using_pro#hooks)
