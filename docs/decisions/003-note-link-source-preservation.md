# Note-link source preservation

Status: accepted for direct parsing and HTML-contained links on 2026-09-14.
The physical-span limitation and secondary block parsing described here are
superseded by [decision 004](004-body-link-source-spans.md).

The specification's [Note Links](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-links.md)
page owns parsing and resolution. The direct parser now retains exact input
`raw`, authored `displayText` and `anchor` components, and the existing processed
target. Missing delimiters omit optional fields; explicit empty components remain
empty strings. Labels/fragments are lexical strings, not rendered labels or
classified anchors. Encoded-anchor interpretation remains a separate open
clarification. Resolver inputs retain their previous three-field contract.

## Pinned Marked seams

Marked 18.0.5 remains exact-pinned. Its tokenizer removes some source escapes
from `text` and `href`. After it accepts an entire internal inline link, the
adapter reads that same grammar's original label/destination captures. A guard
rejects incompatible capture behavior operationally instead of fabricating
source components. The processed `href` still supplies target decoding; source
captures do not introduce a new resolution algorithm.

Body extraction formerly replaced every `<` in HTML blocks with `&lt;` before
reparsing, corrupting destinations and components. A dedicated extraction lexer
now treats HTML as literal prose without rewriting characters. It consumes prose
in chunks, stopping before links, embeds, escapes and inline-code delimiters.
It does not render HTML or execute content.

Marked's pre-extension emphasis-masking loop repeatedly rebuilds the whole
string for HTML tags. Literalizing tags alone exposed quadratic behavior. The
dedicated lexer supplies its own Tokenizer, copies its initialized rule objects,
and removes only the guarded final HTML alternative from `blockSkip`. Link/code
masks and their capture indices stay intact. Shared rules and normal Markdown
lexers are unchanged. On the measured repeated-tag input, 600 KB improved from
about 5.7 seconds after chunking to 55 milliseconds with the scoped mask change;
75/150/300/600 KB measured approximately 10/15/30/55 milliseconds afterward.
The regression test uses a generous 600 KB, three-second ceiling.

Sources:

- [Marked extension and tokenizer contracts](https://marked.js.org/using_pro#extensions)
- [Pinned source captures](https://github.com/markedjs/marked/blob/v18.0.5/src/Tokenizer.ts)
- [Pinned masking loop](https://github.com/markedjs/marked/blob/v18.0.5/src/Lexer.ts)
- [Pinned masking alternatives](https://github.com/markedjs/marked/blob/v18.0.5/src/rules.ts)

Dependency upgrades need review of both guarded seams, the direct/component and
HTML/code/marker regression suites, the large-input timing guard, and the golden
root-escape vector. No native source rewriting or writer capability is implied.

## Historical remaining boundary

Block parsing still normalizes line endings and removes container prefixes.
Consequently, the `raw` passed through body extraction is not yet an exact
physical body substring for every multiline/contextual link. Direct-parser
fidelity and repaired HTML extraction do not establish complete cross-surface
source fidelity or exhaustive Note Links conformance. That work remains in #123.
