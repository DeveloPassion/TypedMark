# TypedMark

TypedMark tooling for the open [TypedMark specification](https://github.com/DeveloPassion/TypedMarkSpecification).

The current package provides a read-only semantic validation adapter for the
`0.1.x` draft compatibility line. JSON Schema checks are loaded from a local
TypedMarkSpecification checkout so the prose and schema repository remains the
source of truth.

## Commands

```powershell
bun install
bun test
bun run typecheck

# Advertise implemented contracts
bun run validate capabilities

# Validate one collection
bun run validate validate <collection-directory> --schemas <specification-schema-directory>

# Compare one checked-in conformance vector with its expected report
bun run validate run-vector <vector-directory> --schemas <specification-schema-directory>

# Instantiate a system as a self-contained working collection
bun run validate instantiate <system-directory> <target-directory> --name <collection-name> --schemas <specification-schema-directory>

# Refuse an automatic update when source history cannot classify it
bun run validate migration-readiness <system-directory> --from <installed-version> --schemas <specification-schema-directory>
```

Validation emits one portable report to standard output. A collection with an
unsupported required extension produces an incomplete report rather than a
successful Core-only result. Validation runs are read-only; the vector runner
also hashes every input file before and after evaluation.

## Adapter boundary

Library callers use `validateCollection` from `src/validator.ts`, discover
contracts with `getCapabilities`, and compare or run vectors through
`src/adapter.ts`. Operational failures throw; they are never converted into an
empty validation report.

Writer operations are intentionally out of scope until TypedMark defines a
separate writer capability. System instantiation is the narrow exception defined
by the system contract: it stages a new target, preserves the metadata artifacts,
removes the source's publishing identity, records composition provenance, and
validates the materialized collection before publishing the target directory.

The checked-in [0.1.0 evidence](evidence/0.1.0/README.md) records the exact
specification and adapter revisions used for the current conformance run.
