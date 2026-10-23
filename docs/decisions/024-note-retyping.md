# Note re-typing

Status: implementation of the maintainer's decision on specification #130,
2026-10-23.

## Decision

Converting a note between existing types must not lose information. The
specification's optional Note Re-typing contract (RT-1..RT-20) carries
compatible values over unchanged under the shared field conversions and keeps
everything else in a `typedmark-preserved` fenced block at the end of the body:
a YAML list of entries recording the source type, preserved field values and
removed H2 sections. The maintainer chose this block over a visible H2 section
(which conflicts with strict headings and would activate links) and over a
sidecar file, and chose semantic losslessness: values keep their parsed types
and content stays recoverable, while formatting may change.

## Interface

`planRetype(collection, schemas, note, type, { map, values })` returns what
carries over, what is preserved or restored, added tags and headings, the target
path, and unresolved requirements. It validates the result on a staged copy of
the collection and only then exposes the content. `applyRetype` writes it with
one rename. The CLI `retype` command prints the plan and writes only with
`--write`.

Limits of this reference writer: it never rewrites links. It moves a note only
when the basename stays the same and no other note links to it by path, which
keeps name-based links resolving; any other move is reported as unresolved
(RT-9, RT-12 allow aborting). Values supplied with `--set` are not invented by
the tool.

## Verification

Eight focused tests cover carrying and preserving, the round trip back to the
source type, appending to an existing block, unresolved requirements, folder
moves and refused path-linked moves, explicit field maps, fence length, and
refused operations. One golden vector shows a block's headings and links stay
inert under strict heading rules and a zero relationship maximum.

Sources: [Note Re-typing](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/note-retyping.md),
[Field Compatibility and Conversion](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/field-conversions.md),
and [CommonMark fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks).
