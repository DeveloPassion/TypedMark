# CommonMark heading source adapter

Status: implemented for the Core heading conformance correction.

TypedMark pins CommonMark 0.31.2 and compares raw block-parser inline source for
headings (RHT-47/56, FND-94), without interpreting emphasis, code or entities.

The existing handwritten parser did not satisfy that contract. Marked 18.0.5,
already used elsewhere, mishandles some valid tab delimiters and other whitespace
cases. A markdown-it 15.0.2 candidate exposed convenient public raw tokens, but
differed from the reference parser on indented setext continuations after link
reference definitions. These are recorded regression inputs, not ignored cases.

Heading extraction therefore uses the reference `commonmark` package, pinned to
exact version `0.31.2`. Its public AST exposes heading structure but not the raw
inline source retained before inline parsing. One adapter isolates the internal
`processInlines` hook and `_string_content` member. It disables inline parsing
for a fresh parser instance, walks heading blocks, joins content lines and trims
outer whitespace. It never renders HTML or mutates collection files.

This is an intentional maintenance trade-off, not an upstream public-API promise.
The dependency is exact-pinned in the manifest/lockfile, runtime guards reject an
unavailable seam, and regressions cover raw source, containers, delimiters, Unicode
and reference definitions. Any parser upgrade needs explicit review of this seam
against the pinned specification and those tests. Other Markdown consumers remain
separate audit items; this change does not claim their complete conformance.

Sources:

- <https://spec.commonmark.org/0.31.2/>
- <https://github.com/commonmark/commonmark.js/blob/0.31.2/lib/blocks.js>
- <https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md>
