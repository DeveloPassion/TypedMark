# TypedMark

TypedMark tooling for the open [TypedMark specification](https://github.com/DeveloPassion/TypedMarkSpecification).

The current package provides a read-only semantic validation adapter for the
`0.1.x` draft compatibility line. JSON Schema checks are loaded from a local
TypedMarkSpecification checkout so the prose and schema repository remains the
source of truth.

## Commands

```powershell
bun install
bun run test
bun run typecheck

# Advertise implemented contracts
bun run validate capabilities

# Validate one collection
bun run validate validate <collection-directory> --schemas <specification-schema-directory>

# Execute a standalone portable query without altering collection declarations
bun run validate query <collection-directory> --query <descriptor.json> --query-version 0.1.0 --schemas <specification-schema-directory>

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

Conformance vectors can include the specification repository's non-normative
`vector.json` negotiation context. Unsupported cases check advertised exact
capabilities; deliberately disabled cases explicitly record the excluded
capabilities. Unmet preconditions are reported as not run. Requirements come
from the collection, and expected findings cannot select evaluation scope.

The adapter checks the standard Views/Queries and Expansion/Expressions
dependency declarations and requires Reuse for inheritance, property sets,
and conditions. Standalone Queries and the bounded Systems adapter are
implemented. Capability discovery lists standalone query execution under
`operations` and collection-validation support under `extensions`. Collection
validation now also implements Queries and Views for datasets, saved views,
and their embedded queries over supported note models. Reuse is implemented;
Expressions, Automation, and content-expansion query surfaces remain unsupported.

## Query pilot

`queryCollection` in `src/query.ts` evaluates portable queries over effective
concrete note models. It supports boolean, path, field, and relationship
predicates; direct and converted projections; ordering, limiting, and grouping.
It captures file bytes, builds an isolated temporary snapshot, and rejects
detected source changes during the read. Model construction and query evaluation
use the captured snapshot, which is removed afterward.

Results contain `evaluation`, ordered `rows`, per-column `provenance`, and
optional `groups`. Provenance's `source_backed` classification is informational
and grants no write permission. `QueryError.rule_id` identifies semantic
failures; operational errors remain distinct. The CLI writes results to stdout
and semantic errors to stderr.

Queries distinguish effective-value predicates from stored-presence tests and
stored-value projections under the existing specification. Unsupported model
dependencies such as disabled Reuse or computed fields prevent evaluation of the
affected notes. Unrelated optional contracts do not block a Core query. Query
`evaluation` describes the operation's interpretation; collection conformance
and unsupported required extensions remain in the separate validation report.
No missing clock or random values are generated, and no source is rewritten.

The `query-pilot-valid` golden vector runs six cases, comparing normalized
evaluation, rows, groups, and expected failure rules. Provenance remains in the
actual evidence and has separate regression coverage. This implements the
standalone query pilot toward B4 in specification issue #123.

## Dataset and view validation

Validation evaluates each dataset query once against the captured collection
model, checks its common column definitions and row identity, and reuses that
result for referring views. Saved views also support embedded queries, with
version, presentation-column, and typed board-value checks. Findings use the
owning dataset/view path and rule identifiers.

`views-valid` and `views-invalid` exercise complete supported-contract reports
and semantic failures. Validation stays incomplete when a required query/model
dependency is unavailable or queries belong to an unsupported body contract;
it does not turn unavailable interpretation into invalid dataset content.
Unsupported and deliberately limited contracts remain visible in reports.
Content-expansion query surfaces and broader optional-contract coverage remain
open. No validator renders a UI, rewrites artifacts, or edits notes.

## Reusable schemas

Validation, queries, datasets, and views share the same effective schema map.
Composition applies collection-default property sets, abstract contributions,
field removal, concrete opt-in sets, and local definitions in specification
order. Fields and top-level inherited metadata use whole replacement; local
identity and specification versions are never inherited. Omission defaults are
expanded after composition, without writing them into source files.

Conditional constraints compare effective values but test stored presence.
Every matching rule applies, including conflict diagnostics. Abstract
relationship targets count concrete descendants, assigning each instance to
the most specific declared target. Unused property sets are validated too.

The resolver caches pre-default contributions and traverses ancestry
iteratively. Invalid dependencies remain distinct from unavailable versions or
disabled contracts, so dependent queries cannot silently use a partial model.
Newer compatible source editions retain incomplete best-effort evaluation.
The `reuse-composition-valid` and `reuse-conditions-invalid` golden vectors
cover positive composition and conditional failures; regression tests cover
deep chains, exclusions, references, versions, and relationship cardinality.

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
