# Effective-schema export

Status: implementation of specification #166, 2026-10-26.

## Decision

Agents around the vault read flattened per-type schemas instead of composing
artifacts. TypedMark adds the optional `typedmark:effective-schema` export: one
read-only JSON document per concrete type, with effective values and each
field's origin. It is never stored in a collection or read by validation.

## Interface

Schema resolution now records, per type, the last layer that declared each
field (`ResolvedSchemas.origins`, exposed as `CollectionModel.fieldOrigins`):
local fields, ancestor fields named by their declaring ancestor, and
property-set fields named by their set, even through an ancestor; Core fields
have no entry and export as `core`. `exportEffectiveSchema(model, type)` builds
the document and `exportCollectionEffectiveSchema` reads one snapshot; the CLI
command is `effective-schema <collection> <note-type> --schemas <directory>`.
Abstract, unknown or invalid types are refused.

## Verification

Two focused tests export a type using Core, local, ancestor and property-set
fields, check schema validity, origins, ancestors and mandatory tags, and
check that abstract and unknown types are refused without writing.

Sources: [Effective Schema Export](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/effective-schema.md).
