# Non-repairing RFC URI syntax checks

Status: accepted for generic syntax checking on 2026-09-14. Extends
[destination decoding](005-markdown-destination-decoding.md) and
[retained diagnostics](006-note-link-diagnostics.md); policy questions below
remain unresolved.

## Shared boundary

`hasUriScheme(value)` recognizes an authored ASCII scheme. `isUriReference(value)`
checks the generic RFC 3986 `URI-reference` grammar, including component boundaries,
without decoding, normalizing, resolving or fetching anything. Empty relative
references are valid at this layer. Callers apply their own contract boundary.

URI fields require a scheme and use the shared syntax check. Markdown note links
first process CommonMark escapes/entities and exclude external schemes, then
check their pre-fragment target before its existing percent-decoding step.
The malformed-percent check still covers the entire internal destination.
Wikilinks, authored labels/fragments, source spans, target resolution and managed
diagnostic ownership are unchanged. Invalid target spelling remains a located
`NL-6` failure rather than a graph edge or a silently dropped link.

This replaces WHATWG `URL` parsing as field validation. URL construction repaired
illegal raw characters and accepted malformed percent escapes, while imposing
transport-oriented restrictions on generic URI ports. The installed `fast-uri`
parser also repairs characters, so parser success was not an adequate validation
boundary. No new dependency is added.

## Grammar and long inputs

The implementation separates fragments, queries, schemes and authorities before
checking component characters. A linear ASCII/percent-triplet scanner preserves
escaped octets as syntax data. It does not require those octets to encode UTF-8.
Unreserved and sub-delimiter characters are shared; each component adds only its
permitted punctuation. A relative first path segment excludes a literal colon.

Authority validation covers optional userinfo, registered names, IPv6/IPvFuture
literals and decimal ports. `node:net.isIP` validates IPv6 locally; a separate
guard rejects zone identifiers excluded by RFC 3986. Invalid IPv4-looking numeric
names can still be registered names. Generic syntax allows empty hosts/ports and
does not impose a 65535 port ceiling. Scheme-specific, DNS and transport policies
are not inferred from the generic grammar.

Independent review found that quantified-alternation regexes silently rejected
valid components around one million characters on Bun. The scanner removes that
accidental size restriction. Regression tests cover long accepted components and
invalid tails. Re-review checked 393,216 character/escape cases and valid components
up to ten million characters without discrepancies.

The original URI strings remain untouched, including scheme/host case, percent
escape spelling and dot segments. URI equality continues to use the declared
field-value contract, not URL normalization.

Sources:

- [RFC 3986 collected grammar](https://www.rfc-editor.org/rfc/rfc3986#appendix-A)
- [Authority syntax](https://www.rfc-editor.org/rfc/rfc3986#section-3.2)
- [Path syntax](https://www.rfc-editor.org/rfc/rfc3986#section-3.3)
- [Query and fragment syntax](https://www.rfc-editor.org/rfc/rfc3986#section-3.4)
- [Node IP syntax helper](https://nodejs.org/docs/latest-v22.x/api/net.html#netisipinput)
- [TypedMark field formats](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/field-definition-reference.md#format)
- [TypedMark note links](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-links.md)

## Unresolved policy

FDR-140 says “absolute URIs”; RFC 3986's formal `absolute-URI` production excludes
fragments, while its `URI` production includes them. Existing scheme-qualified
fragment acceptance is retained pending the maintainer's clarification. This is
not a decision to rewrite the specification, and the new golden URI-field vectors
avoid fragments. The shared helper intentionally implements `URI-reference`, not
the narrower `absolute-URI` production.

Markdown anchor interpretation/general fragment-character enforcement and the
handling of well-formed non-UTF-8 note-target octets also await answers. No general
UTF-8 restriction is introduced for ordinary URI field syntax. Reference-style
outer links and the pinned Markdown parser's backslash-heavy performance issue
remain separate audit work. This correction is not an exhaustive Core completion
claim or a new writer capability.
