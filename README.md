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

Reports identify the implemented `0.1.0` edition used for evaluation, not an
unsupported or malformed edition copied from the root configuration. A newer
compatible root remains best-effort/incomplete; an unsupported root prevents
child interpretation and querying even when its diagnostic is suppressed.
Declared artifact versions and source bytes are preserved.

Malformed extension declarations retain their well-formed identifier/version
entries in `required_extensions`, including unsupported exact contracts. Invalid
entries receive separate findings; evaluation stays incomplete even when those
findings are suppressed. An invalid container contributes an empty map. The
adapter leaves `evaluated_extensions` empty and blocks model-dependent queries
and system operations until the declaration is repaired, without rewriting it.
See the specification's [validation report contract](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/conformance-and-roadmap.md#validation-reports)
for the portable report rules.

Artifact shape validation does not treat native YAML sets or ordered maps as
empty structural objects. Its temporary JSON-shape projection leaves the parsed
model unchanged, including tagged values in opaque vendor metadata and
unconstrained literal positions. Invalid schema shapes still block dependent
queries when their displayed findings are suppressed.

Note-link checks follow declared object fields and list items at every depth.
Existence and target restrictions apply to stored leaves, not values supplied
by defaults. Findings use dotted field names without list indices. Nested links
do not become typed relationships, and malformed scalar/list containers cannot
create relationship instances.

The direct `parseNoteLink` API retains its exact `raw` input and optional authored
`anchor`/`displayText` components. Missing components are omitted; explicit empty
ones remain empty strings. These are lexical strings, not rendered labels or
classified anchors. The pinned
Marked source-capture seam is guarded and covered by escaped/nested label,
code-span, angle-destination, title and line-ending regressions. Body extraction
adds an exact `source` span with zero-based UTF-16 `start`/exclusive `end` offsets
into the supplied body. Its `source.raw` retains original line endings and
intervening container prefixes, while `raw` remains logical inline Markdown.
Collection models retain original body line endings without rewriting files.
HTML-contained links no longer undergo character replacement during extraction.
The dedicated lexer preserves link/code masks while avoiding quadratic HTML-tag
masking. See the [source-preservation decision](docs/decisions/003-note-link-source-preservation.md)
for pinned dependency seams, and the [body-span decision](docs/decisions/004-body-link-source-spans.md)
for mapping, escaping corrections and original block-boundary handling.
Markdown destinations now process escapes and character references before scheme
classification, fragment separation and one target percent-decoding pass. This
prevents entity-encoded external URLs from creating note relationships. Authored
components and wikilink spelling remain unchanged; see the
[destination-decoding decision](docs/decisions/005-markdown-destination-decoding.md).
`inspectBodyLinks` additionally retains located failures for malformed percent
triplets in targets/fragments. Invalid links cannot create graph edges or unlock
dependent queries through diagnostic suppression. Managed-field syntax findings
use `invalid_note_link` without a duplicate generic field-format error; independent
field constraints remain checked. See the [diagnostic decision](docs/decisions/006-note-link-diagnostics.md).
Shared RFC 3986 checks now validate URI fields and pre-fragment Markdown targets
without repairing characters or changing source strings. Authorities, percent
triplets and component-specific punctuation follow generic URI syntax; no DNS or
transport policy is inferred. See the [URI syntax decision](docs/decisions/007-rfc-uri-syntax.md).
URI-field fragment policy, non-UTF-8 note-target octets and encoded-anchor
interpretation remain open clarifications.

Unknown-field findings retain their severity policy and authored names. Logical
field contexts omit list positions; names that cannot be represented by the
report's dotted-path grammar remain in the message without optional `field`
metadata. This does not rename properties or discard findings.

The optional library `referenceEdition` parameter accepts only `0.1.0` and
throws `RangeError` for other requests. Expected conformance reports do not
select this parameter or the actual report edition.

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
and their embedded queries over supported note models. Reuse, Expressions, and
Content Expansion, Authoring declarations, Template Tracking, and Automation
artifact validation are implemented. Writer and executor capabilities remain separate.

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
dependencies such as disabled Reuse or Expressions prevent evaluation of the
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
Content-expansion query surfaces reuse those interpreted results. Broader
optional-contract coverage remains open. No validator renders a UI, rewrites
artifacts, or edits notes.

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

Template Tracking validates source-preserving markers and receipt state, then
classifies each structurally valid region against its stored baseline, note,
and canonical template digests. Digests normalize line endings only. Note-owned
prose and template frontmatter do not determine drift; unavailable canonical
sources are never mistaken for removed regions. Validation never enrolls notes,
refreshes regions, detaches content, or rewrites receipts.

Authoring validation recognizes immutable declarations and ULID, random, and
sequence generators in composed and nested fields. It checks their declared
shapes and provably incompatible output lengths or finite value constraints.
It never executes a generator or infers past immutability from one snapshot;
stored values remain governed by their declared types and constraints. Disabled
Authoring prevents affected model consumers from claiming full interpretation.

Automation validation checks artifact shape, scope and creation references,
predicate syntax, effective field assignments, protected fields, tag policies,
and managed storage-path compatibility. It never matches or executes events,
obtains schedule instants, stages action effects, or deletes notes. Discovery
advertises `typedmark:automation` only under collection-validation extensions;
no automation execution capability is advertised under `operations`.

Content expansions are checked in managed and untyped note bodies and referenced
templates. Marker grammar uses the CommonMark code-block boundary; auto/manual
regions are compared with current field, relationship, query, dataset, view, or
file sources. Completed once regions never obtain a fresh clock or re-evaluate
source values; pending templates are checked without materialization. Source
values preserve stored presence and per-row numeric definitions. Refreshing,
ejecting, scheduling, and propagation remain separate write operations.

Expressions use a shared deterministic text-template parser with only named
text references and the specified Unicode case transforms. Computed fields
are validated against materialized non-computed sibling values after schema
composition. Stored mismatches and unusable dependencies are findings; computed
values are never silently written or substituted into the read-only model.
Omitted nullable fields keep the normal null fallback, and disabled Expressions
block affected query models, including unrecognized nested constructs.

Library callers use `validateCollection` from `src/validator.ts`, discover
contracts with `getCapabilities`, and compare or run vectors through
`src/adapter.ts`. Operational failures throw; they are never converted into an
empty validation report.

Read-only Systems validation checks scaffold targets
against the resolved concrete schema inventory (`SCE-17`). Missing or abstract
targets are system findings; unavailable target contracts prevent a full Systems
evaluation claim. Strict version no-op readiness cannot bypass these findings
through diagnostic suppression. Validation does not create scaffold content.

`system_definition` validates published artifacts without reading existing notes;
use `both` to include current notes as well. Definition snapshots include metadata
and configuration, and imports also retain explicitly selected licensing files.
Unread metadata links fail operationally instead of appearing to be absent.
Count declarations are checked in every mode, but only note-reading modes enforce
actual counts. The importer strictly checks its completed target, so an
insufficient scaffold still cannot publish. See [validation target scope](docs/decisions/002-validation-target-scope.md).

Pending template sources receive static query, artifact, column, and internal-link
checks without evaluating source values. Dataset/view contracts are separate from
their live rows. Invalid mappings do not stop independent artifact checks; when
they leave existing notes uninterpreted, coverage remains incomplete even if the
mapping diagnostics are suppressed. A known-empty inventory can still be fully
interpreted as invalid.

Writer operations are intentionally out of scope until TypedMark defines a
separate writer capability. System instantiation is the narrow exception defined
by the system contract: it stages a new target, preserves the metadata artifacts,
removes the source's publishing identity, records composition provenance, and
validates the materialized collection before publishing the target directory.

Instantiation selects a scaffold override or the type's effective explicit,
conventional, or derived starter. It retains derived field omissions, fills
template placeholders from defaults and declared Core generators, and keeps
explicit caller nulls distinct. Mandatory tags are appended without removing
authored tags. Unique generated values reserve concrete values across the whole
scaffold before generation. Optional Authoring generators are not implemented by
this importer and cause an explicit failure when generation is needed.

Source validation, template reads, metadata copying, and preparation share one
captured snapshot. Import preserves the configuration body and conventional
licensing/attribution files even when note-discovery exclusions match them;
arbitrary legal-file discovery is not defined by the specification. Source and
destination cannot overlap, including through a junction alias. Files are staged
with exclusive creation, checked under strict validation, and published only
after the complete scaffold conforms. No existing collection is migrated.

The checked-in [0.1.0 evidence](evidence/0.1.0/README.md) records the exact
specification and adapter revisions used for the current conformance run.
