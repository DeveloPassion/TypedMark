# Retained note-link diagnostics

Status: accepted on 2026-09-14. Extends the parsing and source contracts in
[decision 005](005-markdown-destination-decoding.md) and
[decision 004](004-body-link-source-spans.md).

## Inspection versus convenience parsing

The private parser inspection distinguishes recognized invalid destinations
from parsed links and ignored input. `parseNoteLink(raw)` keeps its optional
parsed-link return shape. The additive `inspectBodyLinks(body)` API returns
`{ links, failures }`; each failure has logical `raw`, a physical
`source: { start, end, raw }`, and a `NoteLinkError`. Positions are body-relative
UTF-16 offsets with an exclusive end, just like accepted links.

`extractBodyLinks(body)` remains a convenience view of accepted links. Validation
uses the inspection result so a recognized invalid destination cannot disappear
from the relationship graph. The same traversal preserves exclusions, nested
label links, neighboring links and original source offsets. Parser/source-map
contract failures still surface operationally; they are not converted into
successful empty scans. This library result is not a new portable report shape.

Malformed percent triplets in an internal Markdown target or fragment produce
`NL-6` findings. The check occurs after CommonMark escapes/entities but before
target percent decoding, so `%25GG` becomes literal `%GG` data without being
checked again. External scheme links remain outside internal-link validation;
wikilink destinations remain literal. Invalid links contribute no relationship
edge and do not suppress independently unsatisfied cardinality constraints.

## Managed-field diagnostic ownership

Independent review found that the generic field checker also emitted `FDR-142`
as `invalid_field_value`, contradicting the category boundary in `CM-54` and
defeating `invalid_note_link: warn/off`. Simply dropping that first failure would
also hide later nested value constraints.

The explicit `validateManagedFieldConstraints` entry point delegates note-link
syntax to the graph while continuing other field constraints and nested siblings.
The graph reports `NL-6` for recognized invalid destinations and `NL-7` for other
invalid field forms, with complete dotted field contexts and no list indices.
Standalone field validation, template starter checks, schema defaults and query
operands retain strict syntax checking; they do not assume a managed-note graph.

Graph failures remain independent of display severity and prevent queries from
using invalid dependent note models. Suppression can produce an empty, valid
portable report under the configured policy without asserting that an invalid
link model is usable. Artifact-only `system_definition`, note-inclusive `both`,
and strict completed-import validation are unchanged. Template-body evaluation
scope is not expanded by this decision.

Sources:

- [TypedMark note links](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-links.md)
- [Diagnostic categories](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/collection-model.md#collection-model-specification)
- [RFC 3986 percent encoding](https://www.rfc-editor.org/rfc/rfc3986#section-2.1)
- [RFC 3986 decoding order](https://www.rfc-editor.org/rfc/rfc3986#section-2.4)

## Remaining boundary

General RFC 3986 target-character enforcement, interpretation of encoded anchors,
and well-formed percent octets that do not encode UTF-8 remain separate work.
The latter two policies are awaiting maintainer clarification. Existing handling
of undecodable targets is not claimed fixed by the malformed-triplet check.
Reference-style outer links and the pinned parser's backslash-heavy performance
case also remain open. No URI repair, anchor matching, note rewriting or writer
capability is introduced.
