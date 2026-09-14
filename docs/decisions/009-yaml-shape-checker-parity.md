# YAML shape-checker parity

Status: accepted on 2026-09-15 (Europe/Brussels).

## Problem

AJV's JavaScript object test accepts native YAML sets, ordered maps, timestamps
and binary values as objects. The runtime already projected these values before
shape validation, but the specification fixture checker did not: empty sets and
ordered maps could pass structural mapping checks. A separate regression showed
that the runtime's recursive projection overflowed on 20,000 levels of otherwise
opaque vendor metadata.

## Decision

Both checkers use an iterative, non-mutating shape projection. Plain mappings and
arrays are copied through a worklist and identity map. Native non-JSON values get
identity-specific symbols: JSON type constraints reject them, while unconstrained
schema positions still accept them. Repeated references remain repeated references;
distinct native values do not become false duplicates. Own property definition
retains authored `__proto__` keys without changing object prototypes.

The fixture checker's callable proxy projects input while forwarding AJV's live
errors and schema metadata. A wrapper with copied properties would leave stale
diagnostics after subsequent validation calls. The adapter continues returning
AJV errors through its existing API.

The dependency-free projection is intentionally present in each repository.
Production tooling still accepts a caller-specified JSON Schema directory without
requiring specification TypeScript or its package installation. Test-only parity
checks load the pure helper from the pinned specification checkout and compare
validity and diagnostics. No production dependency or artifact shape changes.

## Verification and limits

Regression cases cover structural mappings at several depths, opaque metadata,
literal positions, shared aliases, cycles, live diagnostics, prototype keys,
classified examples and golden-vector source-byte preservation. Four permanent
artifact fixtures distinguish structural tags from opaque metadata. The deep
graph regression exercises 20,000 levels without recursive projection.

This fixes the checker/runtime tagged-value mismatch, not every YAML or AJV
behavior. Literal type conformance remains semantic validation. The worklist does
not establish unbounded depth support for AJV's recursive structural schemas or
the YAML parser. Validation does not rewrite original values or source files.

Sources:

- [YAML baseline](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/foundations.md#yaml-baseline)
- [Schema boundary](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/schema/docs/schema-boundary.md)
- [AJV callable validator API](https://github.com/ajv-validator/ajv/blob/v8.20.0/docs/api.md)
