# Scalar allowed-value boundary

Status: accepted on 2026-09-15 (Europe/Brussels). Completes the separate
`allowed_values` limitation identified during [checker-parity review](009-yaml-shape-checker-parity.md).

## Context

FDR-197 and the field-property representation table already define scalar-only
allowed entries. The shared JSON Schema enforced a nonempty, unique array but
omitted its item shape. Consequently, invalid mappings with authored `valueOf`
or `toString` properties reached AJV's object-equality helper and threw `TypeError`.
Comparing distinct cyclic mappings overflowed that helper's stack.

## Decision

The published schema now gives each allowed entry the JSON scalar type union:
string, number, boolean or null. Uniqueness is guarded by that scalar shape and
evaluated in a separate subschema without a direct `items` keyword. Invalid
entries receive item-shape diagnostics without entering equality comparison.
This fixes the missing specification mirror without
a custom equality engine, exception swallowing, projection changes or new
production TypeScript. The rule itself is unchanged.

Review rejected the initial unguarded scalar union: AJV 8.20.0's optimized hash
appends an underscore to string keys and stores them in an ordinary object.
Duplicate `"__proto_"` values therefore became prototype-setter writes and were
not detected. The guarded separate subschema retains AJV's primitive equality
comparison, avoiding that optimization while keeping invalid objects out. Its
worst-case pairwise comparison cost is the same as the previous unconstrained
uniqueness path; this is not a general performance improvement.

The shared definition reaches note types, property sets, nested fields, anonymous
list items and mapped-query definitions through existing references. Existing
owner-level shape diagnostics and suppression-independent query blocking remain.

Declared field-type compatibility, nullability, format checks and normalized
field-value equality remain semantic. Distinct JSON strings can still be equal
under NFC. The union does not grant a field permission to use every scalar type.
Opaque metadata and unconstrained default/constant values retain their existing
shape treatment, including native tags and aliases; no input is rewritten.

## Verification and limits

Twenty-five schema tests and twenty collection/query regressions cover structured
entries, method-like keys, cycles, opaque aliases, source bytes, suppression,
scalar controls and the semantic boundary. Seven artifact fixtures separate valid,
invalid-shape and semantic-only cases. Older tests that treated structured allowed
entries as shape-valid now assert rejection under the existing scalar-only rule.

This addresses the reproduced `allowed_values` boundary, not every recursive
schema, YAML-parser limit or custom schema that a caller might load into AJV.
It is not an implementation of arbitrary cyclic-object equality.

Sources:

- [TypedMark allowed values](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/field-definition-reference.md#allowed_values)
- [AJV type, items and uniqueness keywords](https://github.com/ajv-validator/ajv/blob/v8.20.0/docs/json-schema.md)
- [Pinned AJV uniqueness implementation](https://github.com/ajv-validator/ajv/blob/v8.20.0/lib/vocabularies/validation/uniqueItems.ts)
