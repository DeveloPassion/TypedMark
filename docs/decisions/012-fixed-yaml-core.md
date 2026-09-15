# Fixed YAML Core resolution

Status: accepted on 2026-09-15 (Europe/Brussels).

## Problem

FND-25 fixes YAML 1.2 Core parsing. The parser's default version did not enforce
that contract: a `%YAML 1.1` directive changed words such as `yes` into booleans,
`012` into legacy octal, and plain dates into native timestamps. It also enabled
implicit merge keys and changed which mapping keys were duplicates. The authored
directive could therefore change validation, effective defaults and import values.

## Decision

Both checker parsing paths (frontmatter and classified YAML examples/fragments)
and the runtime frontmatter parser explicitly select `schema: "core"`, retain
known explicit tags, disable implicit merge activation and check duplicate keys.
The default document version remains `1.2`, but resolution no longer depends on
that default surviving a directive. The options are standard YAML library settings,
not source-text rewriting or a ban on directives.

`resolveKnownTags: true` matters: document version 1.1 otherwise defaults it off
when constructing a Core schema override. The fixed profile retains the existing
explicit set, ordered-map, timestamp, binary and merge-tag behavior, with Core
resolution for their nested scalars. A bare `<<` key remains ordinary data; an
explicit `!!merge` tag retains its pre-existing default-Core behavior. This does
not add a new tag or writer capability.

The existing frontmatter grammar, single-BOM handling, body preservation, alias
limits, source bytes and semantic field checks are unchanged. A plain `yes` is
valid text but cannot satisfy a checkbox field. The correction reaches collection
configuration, schemas, notes, templates and system import through their current
shared readers.

## Verification and limits

Thirty checker and thirty-three runtime regressions cover scalar/key resolution,
known tags, aliases, implicit/explicit merges, duplicate detection, body/BOM behavior,
collection validation and import. Positive and negative golden vectors verify the
baseline through portable reports, alongside valid and semantic-only artifact
fixtures. Existing no-directive and YAML 1.2 controls retain their outcomes.

This corrects the documented Core resolution profile; it does not invent a policy
for unrelated unknown directives or remove declared source text. Runtime JSON
byte decoding remains a separate correction.

Sources:

- [TypedMark YAML baseline](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/foundations.md#yaml-baseline)
- [YAML parsing and schema options](https://eemeli.org/yaml/#options)
- [Pinned options contract](https://github.com/eemeli/yaml/blob/v2.9.0/src/options.ts)
- [Document schema selection](https://github.com/eemeli/yaml/blob/v2.9.0/src/doc/Document.ts)
