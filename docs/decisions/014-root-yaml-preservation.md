# Preserve YAML values during root instantiation

Status: accepted implementation decision on 2026-09-15 (Europe/Brussels).

## Problem

The one-source importer converted root frontmatter to JavaScript, cloned it,
changed the publishing fields, and serialized it with the default YAML writer.
Opaque vendor metadata lost native Set, ordered Map, timestamp and binary types.
Unknown tags disappeared, distinct complex keys collapsed, and a metadata alias
to the source root acquired the new collection's identity. Target validation
accepted the changed metadata: conformance was not evidence of preservation.

## Decision

Capture the parsed YAML document inside the same stable source snapshot as the
data and body. `parseMarkdownWithNodes` shares the existing parser and its error
boundary; `parseMarkdown` retains its exact three-field return shape.

The root-specific writer clones that document and resolves aliases against their
original preceding anchors. It constructs a separate root with the new identity,
optional description and provenance, omitting publishing version and scaffold.
Only root merge entries are expanded, retaining explicit-field and ordered-source
precedence, so inherited publishing fields cannot return through a merge.
Unchanged values retain their original YAML nodes, tags and mapping-key types.
For numeric and timestamp scalars, the writer also retains the original scalar
text under its resolved tag: native Number/Date projections cannot represent
arbitrary YAML integer/float precision or timestamp fractions. The cloned schema
uses source-aware scalar serializers without changing validation projections.

A traversal emits each reachable value once and assigns fresh anchors for later
references. Removed anchor definitions are thus moved to their first surviving
use, and a source-root self-reference retains the original source graph rather
than pointing to the new root. Reused source anchor names are resolved before
any movement. Mapping pairs are copied as edges, not shared mutable identities.

The output uses default YAML 1.2 directives and suppresses stream markers.
Custom tag handles expand to full tag URIs; no internal `---` line can prematurely
end the Markdown frontmatter. Multiline strings are quoted to decouple their
values from the closing delimiter's line break. The body is appended unchanged.

## Alternatives and limits

Custom JavaScript serializers for the four native types would not retain unknown
tags or complex keys already lost during projection. Editing the original root
in place would change aliases to overwritten values or strand deleted anchors.
Both approaches were rejected because they fail the preservation requirement.

This is the bounded instantiation writer, not a canonical-serialization claim,
general editor or migration engine. Frontmatter formatting and anchor names may
change. Metadata-directory artifacts and licensing files remain byte copies;
the separate scaffold-note materializer/serializer is unchanged. Reader boundary
semantics and general writer fidelity still require their own audit.

Highly shared graphs that also reference the source root can exceed the reader's
alias-expansion budget after adding the new root. This is a known E1 operability
gap, not a complete import-support claim. Staged validation rejects such output;
no target is published and source bytes are unchanged. This increment deliberately
keeps the resource guard and graph sharing instead of disabling the guard or
silently duplicating/changing metadata values. The graph-layout/reader-budget
interaction remains open in the plan ledger.

## Verification

Integration regressions reproduce all seven original failures and check source
bytes, copied artifacts, body, new identity and provenance. Focused writer tests
cover merge precedence, repeated anchor names, pair sequences, shared scalars,
negative zero, custom directives, trailing blank lines and input-document
immutability. Source-aware precision assertions include integers beyond safe
Number range, float overflow and sub-millisecond timestamps. A valid-source
alias-budget reproduction checks fail-closed publication and cleanup. Existing
reader, template, import and conformance checks remain
part of the normal repository gates.

Sources:

- [YAML Document API](https://eemeli.org/yaml/#documents), pinned `yaml` 2.9.0
- [YAML aliases](https://eemeli.org/yaml/#alias-nodes)
- [Stream directives](https://eemeli.org/yaml/#stream-directives)
- [Explicit merge precedence](https://yaml.org/type/merge.html)
- [Vendor metadata preservation](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/extensions.md#vendor-metadata)
- [System instantiation](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/systems-composition-evolution.md#importing-and-instantiating-a-system)
