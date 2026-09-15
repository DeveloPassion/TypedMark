# Read-only deletion and archive audit

This is non-normative evidence for the D7/E2 work in
[specification #123](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123).
It checks existing behavior, not a new lifecycle policy or writer operation.

The audit uses specification `82d020073cbc32aabcc0693f7311f99521b62459`
and the runtime from tooling `03886a23cddc0cebc486cdad77131d6857c609d2`.
The enclosing commit adds tests and this evidence without changing that runtime.
It was prepared in an isolated worktree; the uncommitted scaffold-preservation
work in the main worktree is not part of these results.

## Checked consumer matrix

The new [lifecycle integration suite](../../tests/lifecycle-read-audit.test.ts)
uses real files, schemas, validation, model construction, link resolution and
standalone query execution. Its state rows are omitted flags and all four
explicit boolean combinations of `deleted` and `archived`.

| Concern and authoritative rules | Evidence checked |
| --- | --- |
| Effective flags and independent state: MN-52/53/54/71/74, NTS-138/144 | Omitted flags read as false. Each source state retains its type, identifier and effective field default. Matching storage branches pass; the opposite branch fails for each explicit state. |
| Persisted conformance: MN-56/72 | Every source state reports field, heading, path and relationship violations. Matching positive cases remain valid. |
| Type counts: NTS-71 | A one-source minimum/maximum remains satisfied in every source state, including deletion and archiving. |
| Identifier uniqueness: MN-48 | An equal identifier on a different concrete type is diagnosed in every source state. |
| Resolution: MN-57, NL-14/15/18 | IDs, basenames, aliases, explicit wiki paths, Markdown paths and embeds resolve to targets in each target state. |
| Cardinality: RHT-31/32/33/36/37 | Deleted targets contribute no instance for either relationship kind; archived-only targets still contribute. Deleted sources still receive minimum-cardinality failures. Field-only, body-only and embed-only cases independently exercise `related_to`, before the combined references verify idempotent counting. |
| Query selection: QRY-1, CM-306 | Archived-only sources remain candidates; deleted sources require `include_deleted`. Including a deleted source does not restore its deleted targets to relationship traversal. |
| Untyped scope: MN-8, CM-386 | Lifecycle-looking properties do not associate an untyped note, create an identifier collision with managed notes, or admit it to an unfiltered `include_deleted` query. |
| Read-only behavior: MN-298, CM-316 | Each new case compares the complete input file-path/SHA-256 list before and after its read operations. Stored omission remains omission. |

The new suite also checks archive-block omission (NTS-145): archived sources,
whether deleted or not, pass at the active location and fail at a different one.
The matrix is not a Cartesian product of every source state with every target
state, every constraint or every link spelling.

## Verification and boundaries

`bun test ./tests/lifecycle-read-audit.test.ts` passes 40 tests with 242 assertions
against the existing implementation. The final full local run passes 1,731 tests
across 76 files, with 4,734 assertions (376.46 seconds). Type checking and
`bun audit` also pass. A separate conformance run against the unchanged runtime
at the revisions above passes 71 eligible vectors and 16 query cases, with no
failures or input changes; two historical unsupported-Views preconditions remain
explicitly not run out of 73 discovered vectors.

These checks do not establish rename/move preservation, archive or delete writes,
backlink repair, hard-deletion warnings, alias-collision policy, all inheritance
precedence, or exhaustive Core conformance. The source-state tests use Core-only
collections; the query operation is tested separately and does not become a Core
validation dependency. The broader D7/E2 ledger remains open.

Scaffold YAML fidelity and source-root alias-budget operability remain separate
unfinished E1 work. This audit neither resolves those failures nor authorizes
publishing the paused scaffold changes.
