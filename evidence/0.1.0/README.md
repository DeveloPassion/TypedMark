# TypedMark 0.1.0 conformance evidence

This record covers sixty-four golden vectors at TypedMarkSpecification
`38295edd64d0598e0a227c3fd08e5be274a8aa85`, using adapter
`6f0e7719d7bf2dbb9997d68ca39ae13b45cbfd5d` on 2026-09-14.

The recorded JSON is the unmodified conformance output from the successful
[pinned CI run](https://github.com/DeveloPassion/TypedMark/actions/runs/34894856538),
which ran the repository's conformance command against these exact revisions.

Results:

- sixty-two eligible collection vectors passed;
- fourteen standalone query cases passed, including expected semantic failures;
- zero collection path or byte changes;
- zero unexpected validation or query failures;
- no vector was skipped for an unsupported validation contract; and
- two historical negotiation cases were not run because their precondition,
  unsupported Views, no longer applies to this adapter.

Collection-validation capabilities include Reuse, Queries, Views, Expressions,
Content Expansion, Authoring declarations, Template Tracking, Automation
artifacts, and the bounded Systems contract.
Standalone query execution remains separately advertised under `operations`.
Positive and negative Authoring/Tracking vectors join the existing combined
derived-contract corpus. Notes, queries, datasets, views, expansion sources,
tracking state, and automation references share the captured effective model.

The Core audit adds regression coverage for default Git exclusions, full-path
Unicode globs, protected metadata, and safe subtree pruning. Ordered association
now preserves the first winner, including invalid dynamic candidates, and
checks declarations even with no notes. Stored predicates share exact YAML-value
comparison while preserving the distinction between absent and empty frontmatter.
Association availability is independent of diagnostic suppression. The parser
recognizes unclosed delimiters as body content, rejects invalid UTF-8 without
replacement, and keeps YAML alias limits inside structured diagnostics. These
were implementation corrections without normative prose or artifact shape changes.

Uniqueness now uses the shared type-aware equality domain, with collection-wide
same-name/same-property-type scope derived from concrete schema declarations.
The count-range implementation was already present; new regressions and vectors
verify it independently of note population. History now selects its own Core
artifact version, preserves best-effort incompleteness, and reports specific
shape/provenance diagnostics. Readiness uses one strict, immutable snapshot and
does not mistake suppressed errors or history availability for migration impact
analysis: only a validated version no-op can be ready.

History ordering now enforces the accepted strict SemVer precedence policy in
`SCE-99`: equal precedence is rejected even when build metadata differs.
Prerelease identifiers use numeric or ASCII comparison as appropriate, including
numbers beyond JavaScript's safe integer range. Build metadata is ignored only
for ordering; the final exact-version check remains unchanged. The positive and
negative history-order vectors exercise this policy without rewriting history.

Best-effort diagnostics for schemas, property sets, and history now require an
actual, complete version string on the supported line with a newer patch.
Malformed prefixes, suffixes, trailing line terminators, and non-string values
cannot downgrade structural errors or crash validation through string coercion.
Thirty regressions from the earlier artifact-guard slice cover schemas, property
sets, query eligibility, and history. Valid newer patches remain incomplete
with warnings; unsupported lines remain unavailable.

Root reports now identify the actually implemented edition under `CR-25`.
Newer roots remain incomplete under `CR-102`; unsupported roots cannot supply
child models or bypass query blocking through diagnostic suppression.
The explicit `referenceEdition` API accepts only the implemented edition, and
expected reports no longer select actual evaluation metadata. Root structural
diagnostics select the known mapping branch; path-copy projection preserves
opaque vendor and literal values that share YAML aliases with structural data.
That earlier slice added thirty-three tests, plus the `root-best-effort` and
`root-unsupported` vectors with one query case each, without changing normative
rules or artifact schemas.

Malformed extension declarations now retain exactly the well-formed declared
requirements, including unsupported exact contracts, under the clarified
`CR-99`/`CR-102` policy. Invalid entries have separate findings; suppressed
findings cannot make evaluation complete or unlock query/system models.
Invalid containers, including explicitly tagged YAML sets and ordered maps,
contribute an empty map without becoming valid empty declarations. Invalid
severity settings fall back safely, and all source bytes remain unchanged.
The report schema, fixtures, source-aware checker, and adapter are aligned.
That earlier slice added thirty-three runtime and twelve specification regressions,
without adding golden vectors or executor/writer capabilities.

Scaffold target resolution now follows `SCE-17` against the resolved concrete
schema inventory. Missing and abstract targets produce configurable system
findings; unavailable target contracts prevent a full Systems evaluation claim
without becoming false missing-reference errors. Independent scaffold findings
remain visible beside unavailable history or sibling targets, and strict version
no-op readiness cannot bypass known failures through diagnostic suppression.
The earlier reference-check slice added twenty-two focused regressions and
three `scaffold-references-*` vector integrations. It did not materialize starter
notes or implement migration operations; normative rules and artifact schemas
were unchanged.

Template validation and import now share explicit, conventional, scaffold-override,
and derived starter selection. Concrete template values are checked before caller
values are applied; nested placeholders cannot hide invalid aliases or enum values.
Explicit YAML null and incompatible tagged mappings do not become empty mappings.
Snapshot isolation retains blocked metadata-link paths, including for templates.

The importer materializes declared fields, mandatory tags, deterministic defaults,
and Core clock/UUID generators from one validated source snapshot. Literal caller
values and values inside declared defaults retain their provenance. A shared batch
reserves concrete values before unique generation, and strict target validation
prevents suppressed failures from publishing an invalid scaffold. Source/target
overlap and artifact overwrites are refused; source bytes, configuration body,
and conventional licensing material are preserved. Optional Authoring generators
and arbitrary legal-file discovery are not claimed. The three template vectors
remain read-only; runtime regressions exercise actual temporary imports.

Heading validation now uses CommonMark 0.31.2 block structure and raw inline
source, with case-sensitive NFC comparisons and constraint-specific H2 rule
identifiers. Thirty regressions cover nested blocks, matching fences, setext
continuations, tabs, literal Markdown, Unicode and reference definitions. Two
new read-only vectors cover valid structures and distinct heading failures.
The exact-pinned reference parser's internal raw-source seam is isolated,
runtime-guarded and documented in the [heading adapter decision](../../docs/decisions/001-commonmark-heading-source.md).
This does not claim conformance of other Markdown consumers.

The accepted target boundary is now implemented: `system_definition` checks
published artifacts only; `both` includes existing notes. Artifact snapshots
exclude unrelated notes while preserving empty metadata and explicitly selected
paths. Import and strict version no-op readiness use that source scope; completed
import targets still undergo strict note/count validation. Static query analysis
is separate from row evaluation. Pending templates check artifact/column/type
references, internal-link syntax and query field traversal without resolving
notes or evaluating source values. Missing note evaluation after invalid mappings
keeps coverage incomplete independently of severity, while known-empty inventories
remain fully interpretable. Sixty-seven new focused tests plus four vector
integrations cover this slice; the snapshot foundation added ten earlier tests.
The [target-scope decision](../../docs/decisions/002-validation-target-scope.md)
records the implementation boundary.

Nested note-link validation now descends declared object/list containers, uses
stored leaf presence instead of defaults, and keeps relationship semantics
top-level. Twenty regressions and two new vectors cover this correction.
Unknown-field diagnostics now retain a portable complete dotted context only
when every segment is representable, leaving other source names in messages.
Twenty-four regressions and one vector cover this report correction. All prior
vector machine records remain unchanged in the refreshed CI output.

Direct note-link parsing now retains exact input and authored label/fragment
components, including explicit empty values, Unicode, escapes, nested labels,
angle destinations and optional titles. That slice left target processing and
resolver inputs unchanged. Sixty-nine new focused tests cover this boundary. Independent
review compared 61,899 inputs, including links from all 652 CommonMark 0.31.2
examples; all 33,965 previously accepted inputs kept their form/target/embed data.

HTML-contained links no longer undergo `<` replacement before parsing. Eighteen
new regressions cover raw components, literal entities, code/marker boundaries,
embeds, ordering and large inputs; one new golden vector verifies collection-root
escape detection for an angle destination inside HTML. A guarded, copied-rule
override removes only the dedicated lexer's quadratic HTML masking. The normal
grammar and link/code masks remain unchanged. Independent review checked 30,331
combinations and measured approximately linear 150/300/600 KB scaling at
26/42/84 milliseconds. See the [source-preservation decision](../../docs/decisions/003-note-link-source-preservation.md).
That earlier slice did not provide physical body spans. The subsequent
[body-span adapter](../../docs/decisions/004-body-link-source-spans.md) now retains
zero-based UTF-16 source ranges and exact body substrings alongside logical link
input, including CRLF/CR and intervening container prefixes. Collection models
retain original body endings, including after malformed note frontmatter.
Sixty source/structure regressions and nine reader regressions cover the change;
two new vectors guard escaped-label phantom links and HTML reference-shaped content.
Only original CommonMark code blocks are excluded; HTML is not reparsed into
invented reference/code blocks. Unchanged inline subtrees are reused, reducing
the reproduced 320-level emphasis case from 4.8 seconds to about 57 milliseconds.
Independent review checked 5,000 generated bodies, 11,783 maps, 12,667 spans,
1,304 official/injected CommonMark examples and 84 additional nested-span cases.

Markdown destination processing now decodes CommonMark escapes and character
references once before ASCII scheme classification, fragment separation and one
target percent-decoding pass. Authored labels/anchors and physical spans are
preserved; entity-encoded external URLs cannot invent note relationships.
Eighty-three focused regressions and two new vector integrations cover this slice.
Independent review caught and corrected HTML C1 remapping, then checked 57,617
numeric boundary cases and all 2,125 named references. The valid golden fixture's
real-target minimum and forbidden trap maximum fail independently when mutated.
See the [decoding decision](../../docs/decisions/005-markdown-destination-decoding.md).
That slice left all fifty-nine prior vector machine records unchanged.

Malformed percent triplets in internal Markdown targets and fragments now produce
retained, source-located failures instead of disappearing or contributing graph
edges. Managed-field syntax uses `invalid_note_link` under `CM-54`, without a
duplicate generic field-format error; other constraints and nested siblings remain
checked. Standalone/template validation retains its strict syntax path. Suppressed
diagnostics cannot unlock dependent query models. Sixty-three focused regressions
and three new vectors cover this slice, including a suppressed-report query case.
Independent review checked twenty extraction contexts and sixty model boundaries.
See the [diagnostic decision](../../docs/decisions/006-note-link-diagnostics.md).
All sixty-one previous vector machine records remain unchanged in this CI output.

General RFC 3986 character checks for note-link targets and absolute URI fields,
non-UTF-8 percent-octet handling and encoded-anchor interpretation remain open;
malformed-triplet checking is not exhaustive URI conformance. Pre-existing
quadratic parsing of backslash-heavy destinations in Marked is separately recorded
in the plan audit.

Artifact shape checks now use a prototype-safe, alias-preserving projection.
Native YAML sets/ordered maps cannot masquerade as empty schema or configuration
objects, and suppressed schema failures cannot unlock dependent queries. The
parsed model and source bytes remain unchanged; tagged vendor metadata and
unconstrained literal values remain accepted. Twenty-four additional regressions
cover these boundaries, distinct native-value identity, cycles and own prototype
keys. The golden corpus is unchanged; this is not a global YAML-tag prohibition.

Core field coverage now includes stored identifier nullability, intrinsic alias
restrictions and defaults, and normalized mandatory-tag declarations/membership.
Storage checks distinguish intrinsic pattern syntax from references resolved
after concrete composition. Missing or unsafe path inputs produce findings;
literal text containing `undefined` has no sentinel behavior. Unformatted scalar
substitution stays separate from field-type validation. Formatted date values
use the collection timezone and ISO week-year, and archive patterns replace the
active branch. Invalid configuration remains unavailable to queries even when
its diagnostics are suppressed.

Computed fields remain stored fields, not virtual replacements. Expansion checks
respect stored source values, per-row numeric types, pending-template timing,
and completed-once semantics. Automation validation checks declarations and
action compatibility only: no event matching, scheduling, action execution,
propagation, destructive approval, expansion refresh, or note writes are claimed.

Authoring checks declaration compatibility without generating values or claiming
historical immutability proof. Template Tracking uses line-ending-only digests,
per-identifier structural checks and three-way baseline/note/template comparison.
Canonical availability is independent of diagnostic suppression. It never
enrolls notes, reconciles regions, or updates receipts during validation.

Unavailable model or body contracts prevent full interpretation. They are not
misreported as invalid dataset content, and their dependent supported contracts
are not claimed as fully evaluated. Version findings identify the actual
unsupported root or schema rather than an otherwise supported consumer.

Run the suite with:

```powershell
bun run conformance --spec ..\TypedMarkSpecification
```

Validation covered 1,264 tooling tests locally and in CI, type checking, dependency
audit, 336 specification tests, 292 fixture expectations, rule-ID checks, and the
31-page site build. The test command allows 30 seconds per
filesystem integration case and 300 seconds for the whole vector-suite case;
these are correctness checks, not timing benchmarks.
The final local full suite passed all 1,113 tests with no failures, as did the
pinned CI run. No existing test deadlines changed. The CommonMark dependency
and its development types remain exact-pinned and passed the dependency audit.
The three new specification build tests exercise LF, CRLF and CR source files.
The [reading-path review](site-review.md) records the browser checks and retained
prior-contract links; it is not a release approval.

One earlier local run passed 1,041 tests and failed the importer's final directory
rename with Windows `EPERM`. Its fixture contained no HTML, publication code was
unchanged, and the temporary parent was cleaned up. The isolated test and twenty
repeated test-file runs (60 tests) passed, followed by the complete 1,042-test
rerun at that checkpoint. The current 1,113-test run also passed. The denial's
cause remains unestablished; no retry workaround or
claimed file-lock fix was introduced. The successful example exercise also
rechecked publication and offline validation.

Independent review covered exclusion pruning, metadata resolution, mapping
order, declaration availability, stored/effective predicate separation, Unicode
field-name matching, parser error boundaries, Core field invariants, deferred
storage references, timezone failures, type-aware uniqueness, history version
boundaries, strict snapshot readiness, release precedence, malformed/non-string
artifact version handling, root report editions, branch-aware diagnostics,
YAML-alias preservation, malformed declaration projection, suppression-independent
incompleteness, tagged YAML containers, scaffold target resolution, unavailable
schema dependencies, template placeholder provenance, strict snapshot import,
source/destination isolation, CommonMark heading source, definition-mode counts,
site source-line-ending handling, tagged artifact-shape projection, recursive
links, portable field contexts, definition scope, pending static references,
mapping-failure coverage and the golden reports.
The heading adapter also agreed with the reference on 229 relevant official
CommonMark examples during independent review. The earlier ordering review
also checked 193,600 pairs of 440 schema-valid versions against an independent
BigInt/ASCII comparator, including 1001-digit identifiers; all comparisons agreed.
These results advance B4/E1/E2 and the bounded system-exercise part of E3 in
[specification #123](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123);
they do not establish coverage of every normative rule
or completion of the five-working-day full-validator measurement. The
[plan completion audit](plan-audit.md) records the remaining evidence and work.

General automation execution and writer operations remain follow-up work.
The [2026-09-14 bounded system exercise](system-exercise.json) used TypedMarkExample
`c55578d0ee6996cc82efeda80b7d60cae3ba591b`, with adapter `6f0e771` and specification
`38295edd64d0598e0a227c3fd08e5be274a8aa85`. Its
tracked published example files were exported into a temporary
source; unrelated ignored workspace files were not included or altered. Source
validation and instantiation completed without findings. The instance omitted
publishing `version`/`scaffold`, recorded its composition source, retained the
mandatory tag, and materialized `Notes/Welcome.md`.

After verifying that export's bytes were unchanged, the temporary source was
removed. A separate CLI process then validated the target offline, with no
findings or target changes. The original tracked source paths/bytes were
unchanged, and the temporary instance was removed afterward. Missing history
still returned `manual_resolution_required`, with no migration attempted.
This replaces the historical exercise record; it does not measure the Core
validator's five-working-day implementation effort. History replay, target-aware
impact analysis, and broader composition remain follow-up work.

The [historical inventory](https://github.com/DeveloPassion/TypedMarkSpecification/blob/f0d883d1e4bef51f169fa4d61584d206ac4f0e0f/schema/docs/baseline-0.0.1.json)
reconstructs A1 against the accepted `f995555` baseline: 14 root pages, 1,988
identified rules and 53,441 whitespace-counted tokens, with 15 built pages,
16 schemas and 358 schema references. All 31 inventoried source/schema hashes
match raw Git blobs. The historical frozen install, 166-fixture gate, rule linter
and site build were rerun successfully. This records baseline ownership and
links, not developer effort or a new normative contract.

Lossless note re-typing is separately tracked for future design in specification
[#130](https://github.com/DeveloPassion/TypedMarkSpecification/issues/130).
