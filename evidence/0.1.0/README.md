# TypedMark 0.1.0 conformance evidence

This record covers seventy-six golden vectors at TypedMarkSpecification
`8e7929b9191bf4494dd1a51482043a2784078afe`, using adapter
`7583ab170cbbfa78d57808081f749e1c83288b0d`. Exact UTC run timestamps are
retained in the recorded JSON.

The recorded JSON is the unmodified conformance output from the successful
[pinned CI run](https://github.com/DeveloPassion/TypedMark/actions/runs/34931789904),
which ran the repository's conformance command against these exact revisions.

Results:

- seventy-four eligible collection vectors passed;
- seventeen standalone query cases passed, including expected semantic failures;
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
That slice left all sixty-one previous vector machine records unchanged.

Shared non-repairing RFC 3986 syntax checks now cover URI fields and pre-fragment
Markdown targets. Authorities, percent triplets and component punctuation use
generic syntax without DNS or transport policy. URI strings retain authored case,
escapes and dot segments. Invalid target spelling remains a located note-link
failure; default, constant, allowed-value and query checks share field validation.
Two hundred forty-eight focused regressions and three new vectors cover the change.
The query vectors verify exact projection and an actual admitted note with invalid
URI values; the declaration-only vector does not assert eager empty-query behavior.

Review caught a regex-engine limit that rejected valid million-character components.
A linear scanner fixed it; 393,216 character/escape cases and valid components up to
ten million characters passed independent review. See the
[URI syntax decision](../../docs/decisions/007-rfc-uri-syntax.md).
That slice left all sixty-four previous vector machine records unchanged.

The inline lexer is now extraction-only: emphasis delimiters remain text while
link, image, escape, code-span and HTML tokenizers stay active. Scoped mask-phase
suppression avoids rendering work without disabling URL/title unescaping. Redundant
extension-start scans are removed. This corrects astral mask truncation, leaked
code links and false exclusions after unmatched backtick runs while preserving
logical components and physical source spans.

Twenty-two regressions and two golden vectors cover the change. Review rejected
an intermediate masking implementation, then compared the revised extractor with
CommonMark across 63,778 generated cases and all 652 official examples. The measured
600 KB destination/prose cases fell from about 17.8/30.1 seconds to below 0.1/0.2
seconds; label/code cases also satisfy generous timing guards. See the
[inline-lexer decision](../../docs/decisions/008-extraction-only-inline-lexer.md).
All sixty-seven previous vector machine records remain unchanged in this CI output.

The maintainer has now resolved URI-field fragments, decoded Markdown-anchor
interpretation and non-UTF-8 note-target rejection; see
[decision 016](../../docs/decisions/016-unicode-note-link-components.md).
General raw-fragment character enforcement remains separately unresolved. The measured mask/start-scan slowdown is fixed, not claimed as an
exhaustive parser-performance audit. A separate checker-parity probe found native
YAML sets/ordered maps accepted as structural configuration maps by the specification
fixture checker but rejected by the runtime. The fixture checker is now aligned:
native tagged values do not satisfy JSON object constraints, while opaque metadata
and unconstrained literal positions remain accepted. Live AJV diagnostics are
forwarded without mutating the parsed model. Both checkers use iterative projection,
fixing the runtime's stack overflow on a 20,000-level opaque graph. Thirty new
specification tests, eight tooling tests and four artifact fixtures cover the slice;
see the [checker-parity decision](../../docs/decisions/009-yaml-shape-checker-parity.md).
All sixty-nine prior vector machine records remain unchanged in this exact-source CI run.

The separate `allowed_values` crash is now corrected by enforcing FDR-197's existing
scalar-only item shape and guarding uniqueness in a separate subschema. Invalid
mappings/sequences no longer reach object equality, including authored method-like
keys, null-prototype objects and distinct cycles. The correction shares the existing
schema references across note types, property sets, nested fields and query definitions.
Scalar compatibility and normalized equality remain semantic; aliases and source bytes
are preserved.

Review caught a regression in the initial scalar union: AJV's optimized hash missed
duplicate `"__proto_"` strings. The guarded, separate uniqueness check avoids that
optimization. Twenty-five schema tests, twenty collection/query regressions and
seven artifact fixtures cover the final correction. Independent review checked
1,250 scalar pairs, both error-collection modes, method-bearing objects, cycles and
mixed invalid values without finding further issues. See the
[allowed-value boundary decision](../../docs/decisions/010-scalar-allowed-values.md).
This is not a general cyclic-equality or performance improvement claim.

The subsequent reader correction now accepts CR-only frontmatter and rejects
malformed UTF-8 at every existing checker text-file read, including artifact bodies
and JSON strings. Optional frontmatter rejects top-level native sets after YAML
materialization while keeping nested opaque values intact. Runtime byte and text
inputs consume one leading BOM consistently; extra/interior BOMs stay content.

Thirty checker and fifteen runtime regressions cover delimiters, encodings, optional
blocks, native tags, byte preservation and the doubled-BOM configuration case.
Independent review checked 1,836 grammar combinations and all 65,536 two-byte
sequences without finding an introduced defect. The original three-case parity
probe now agrees. JSON BOM behavior, file discovery and semantic target scope are
unchanged; see the [reader decision](../../docs/decisions/011-text-input-boundaries.md).

The YAML directive gap is now corrected by explicit Core schema settings. Scalar
and key resolution, duplicate detection and implicit merge-looking keys retain their
Core meanings across no-directive, YAML 1.1 and YAML 1.2 inputs. Explicit known tags
and aliases keep their existing support. Thirty checker and thirty-three runtime
regressions cover configuration, notes, templates and import; two new golden vectors
distinguish conforming Core values from a legacy boolean word in a checkbox field.
Independent review added 37 mixed-tag/directive, alias/cycle and preservation probes.
See the [fixed-Core decision](../../docs/decisions/012-fixed-yaml-core.md).

All five runtime JSON file inputs now use fatal UTF-8 decoding before JSON.parse.
Corrupt query predicates, expected reports, query cases, contexts and schema values
cannot be repaired into successful interpretation. Twenty-six regression/control
cases preserve valid Unicode, BOM/syntax/shape policy, source bytes and the in-memory
query API. Loader failures identify their input; migration readiness deliberately
retains its generic manual-resolution wrapper and cannot approve a no-op with an
unreadable schema. Review reconciled that existing adapter contract without changing
it. See the [JSON-input decision](../../docs/decisions/013-strict-json-inputs.md).

These input corrections do not complete the requirement-by-requirement Core audit,
outstanding URI policies, compatibility/release review or measured effort assessment.

The E1/EXT-27 root writer now preserves parsed YAML graphs rather than converting
opaque values through JavaScript. Tagged Set/ordered Map/Date/binary values,
unknown tags, complex keys, aliases to changed/removed fields and ordinary
source-root self-aliases retain their values. Root merge expansion prevents
publishing fields from reappearing. Source scalar text protects integer/float and
timestamp precision beyond native Number/Date. Nineteen new cases include source,
body and artifact preservation, tag directives and fail-closed publication; see
the [root-preservation decision](../../docs/decisions/014-root-yaml-preservation.md).
All seventy-one vector machine records are unchanged from the preceding checkpoint;
the new tests exercise the writer, not a new read-only validation contract.
Independent review found the precision loss and the graph-budget limitation below;
the precision loss was fixed, with no additional findings on the second review.

Highly shared source-root graphs can still exceed the reader's alias-expansion
budget after rewriting. A regression proves this valid-source case aborts without
publishing a target or changing source bytes. The resource guard remains intact;
this E1 operability gap stays open in the [plan ledger](plan-audit.md).
The ordinary published example does not exercise these exceptional graph/value
cases, so its success is not exhaustive metadata-fidelity evidence.

The subsequent newline correction retains the final YAML content line break in
both readers and restores the final content newline in classified YAML/YML fences.
Twenty checker and twenty-seven runtime regressions/control cases retain keep,
clip and strip semantics, exact delimiters, bodies and source bytes. Scaffold
serialization also stops trimming content and quotes multiline strings. Review
reproduced loss of spaces in blank lines; the corrected serializer passed 1,464
independent string roundtrips, including nested values, with unchanged bodies.
See the [terminal-newline decision](../../docs/decisions/015-terminal-yaml-newlines.md).

Two new golden vectors prove correct and incorrect constant matches differing by
one trailing newline. All seventy-one prior vector records are unchanged in the
refreshed exact-source output. The original six-case reader probe now agrees
across both readers, three line-ending styles and both closing delimiters.

Forty [read-only lifecycle checks](lifecycle-read-audit.md) now cover deletion and
archiving across validation, counts, identifiers, links, relationships and query
selection. They do not establish archive/delete writer behavior.

The Unicode-link increment adds fifty-four focused regressions and three golden
vectors. `interpretNoteLinkAnchor` supplies decoded heading/block values without
changing the authored `anchor`, raw link or physical body span. Non-UTF-8 internal
components remain located `invalid_note_link` failures under NL-11, including when
query/model use is blocked behind suppressed diagnostics. URI fields retain
fragments and arbitrary well-formed percent octets. All seventy-three prior vector
records are unchanged; the three new vectors and suppressed query case pass.
The raw-fragment character-validation conflict remains open, with NL-6 unchanged.
See [decision 016](../../docs/decisions/016-unicode-note-link-components.md).

A separate valid-source scaffold probe confirms the next fidelity defect: Set,
ordered Map, Date and binary values in declared `any` fields become arrays,
ordinary mappings or text in a valid target. Source bytes stay unchanged, but
the values change type. Neither the newline fix nor target validation establishes
general native-value preservation; that correction remains open in the ledger.

Runtime artifact shape checks use a prototype-safe, alias-preserving projection.
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

Validation covered 1,788 tooling tests locally and in CI, type checking and
dependency audit. The final local source run completed 4,943 assertions across
77 files in 683.31 seconds. The matching specification checkpoint passed
471 specification tests, 317 fixture expectations, rule-ID checks, and the
31-page site build. The test command allows 30 seconds per
filesystem integration case and 300 seconds for the whole vector-suite case;
those timeouts are not performance budgets. The inline-lexer regression cases
have separate three-second performance ceilings.
No existing test deadlines changed. The CommonMark dependency
and its development types remain exact-pinned and passed the dependency audit.
The three earlier specification build tests exercise LF, CRLF and CR source files.
The [reading-path review](site-review.md) records the browser checks and retained
prior-contract links; it is not a release approval.

One earlier local run passed 1,041 tests and failed the importer's final directory
rename with Windows `EPERM`. Its fixture contained no HTML, publication code was
unchanged, and the temporary parent was cleaned up. The isolated test and twenty
repeated test-file runs (60 tests) passed, followed by the complete 1,042-test
rerun at that checkpoint. A later 1,113-test checkpoint also passed. The denial's
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
The [latest bounded system exercise](system-exercise.json) used TypedMarkExample
`c55578d0ee6996cc82efeda80b7d60cae3ba591b`, with adapter `7583ab1` and specification
`8e7929b9191bf4494dd1a51482043a2784078afe`, executed at
`2026-09-15T05:12:43.615Z`. Its
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
