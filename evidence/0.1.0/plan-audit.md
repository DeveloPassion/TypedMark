# Refocus plan completion audit

This is non-normative implementation evidence for
[#123](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123), not a
replacement specification. The active objective remains **finish implementing
the rest of the plan**. A passing test count is not proof of full completion.

Session wrap-up: the [complete resume map](session-handoff-2026-09-15.md)
supersedes older in-progress paragraphs below. Anchor encoding is now decided
and saved in specification #131/tooling #4; scaffold and root-budget work are
saved in tooling #5/#6. All are drafts, not completed or merged requirements.

## Scope and decisions

The accepted target is an unreleased `0.1.0` draft, preserving the prior `0.0.1`
contract. All inheritance/property-set composition belongs to Reuse; vocabularies
remain Core. Optional templates, the accepted Core field set, sparse stored
values, and explicit incomplete capability reports remain in scope.

Sources inspected:

- [Coordinating plan](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123)
- [Accepted Core/field/template decisions](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123#issuecomment-5516239442)
- [Release decision and baseline](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123#issuecomment-5570114137)
- [Accepted Reuse boundary](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123#issuecomment-5570223238)
- [Prior baseline tree](https://github.com/DeveloPassion/TypedMarkSpecification/tree/f9955555928ab69573d5e8beb376e9e98c3813e2)

General writers/backlink repair, automation execution, new view layouts,
cross-root syntax, companion-repository transfers, and lossless note re-typing
remain separately tracked follow-ups as the plan specifies. Their omission is
not evidence that the refocus work is complete, nor permission to close them.

## Requirement ledger

“Present” identifies inspected implementation or artifacts. It does not replace
the remaining completion checks in the last column.

| Package | Present evidence | Remaining completion check |
| --- | --- | --- |
| A1 baseline | [Reconstructed historical inventory](https://github.com/DeveloPassion/TypedMarkSpecification/blob/f0d883d1e4bef51f169fa4d61584d206ac4f0e0f/schema/docs/baseline-0.0.1.json), all 31 source/schema hashes checked against Git blobs, original gates rerun, and fixed prior-contract links | Baseline verification is complete; do not infer developer effort from it. |
| A2 rule identity | Spec rule registry/linter; moved, retired, missing and dangling-ID regression tests | Keep linter/report grammar aligned after subsequent changes. |
| A3 examples | Explicit example annotations, dataset/golden integrity checks, fixture tests | Run the final exact-revision fixture gate. |
| A4 runner contract | `src/adapter.ts`, `src/suite.ts`, version/capability context, machine-field comparisons and input hashes | Preserve the distinction between read-only vectors and write-operation tests. |
| B1 declaration/report seam | `src/schema-registry.ts`, capability negotiation and malformed-declaration regressions | Recheck final positive/negative capability evidence. |
| B2 shared prerequisites | Shared path, value comparison and conversion modules; source-owned contracts | No independent query requirement may leak into Core or Systems. |
| B3 query extraction | Separate query contract and standalone query execution | Retain supported/unsupported operation cases. |
| B4 executable pilot | Core-only, unsupported capability and supported query vectors | Keep exact source/specification revisions in recorded outputs. |
| C1 Reuse | Spec ownership split plus `src/reuse.ts` and integration tests | Final ownership/dependency audit. |
| C2 optional modules | Dataset/view, expression, tracking and expansion owners and validators | Final truthful capability-scoped coverage; no writer/executor claim from validation support. |
| C3 automation ownership | Separate artifact/runtime/interchange pages; read-only artifact checks | Execution remains a separate follow-up, not a Core validator prerequisite. |
| C4 Systems ownership | Systems/history/migration contracts; local provenance and offline validation | Do not claim history replay, target-aware migration or external composition resolution where absent. |
| D5 values/templates/Core fields | Effective-record tests; template resolution, placeholder checks and import materialization work | Final integrated template/import verification, including explicit values and source preservation. |
| D6 boundaries/paths/headings/time | Discovery, path, storage and timezone suites; pinned CommonMark heading adapter, 30 heading regressions and two golden vectors | Heading correction is implemented; continue auditing other Markdown consumers against their own contracts. |
| D7 identity/merge/tags/archive/untyped | Core field, uniqueness, association, Reuse and storage suites; [read-only lifecycle consumer matrix](lifecycle-read-audit.md) | Deletion/archive source and target states now have explicit integrated evidence. Continue the remaining identity/merge/tag/untyped audit; this does not establish writer behavior or close the row. |
| D8 simplifications | Removed-shape fixtures, retained count/object constraints, migration checklist | Verify each intentional incompatibility has a migration or explicit manual-resolution outcome. |
| D9 feature moves/removals | Reuse/Expressions/Authoring ownership; old folder-scope/generated forms rejected | Verify no undocumented equivalence or data-loss claim in the compatibility ledger. |
| E1 useful system path | One-source staged instantiation, local provenance, strict readiness, and the 2026-09-14 published-example rerun after deleting its temporary source | Continue auditing remaining import boundaries; replay and multi-source/external resolution are not claimed. |
| E2 conformance | Golden collection reports, query cases, nested-link traversal, portable diagnostic contexts, artifact-only target checks, pending static references and tooling regressions | **Open:** complete the remaining Core audit and verify the required positive/negative scopes; no exhaustive claim yet. |
| E3 effort/spike | Executable implementation and historical bounded example exercise | **Open:** recorded hands-on effort before the current goal is not available; commit dates do not prove developer effort. Obtain the log/assessment or explicit ADR disposition. |
| E4 release/readability | Generated site, audience metadata, budgets, fixed prior-contract links and the 2026-09-14 rendered reading-path review | **Open:** remaining compatibility/release-policy dispositions. No release is approved by this file. |

## Current implementation boundaries

The template/import work separates read-only starter interpretation from
write-time materialization. It checks explicit scaffold overrides before caller
values can hide invalid template content, preserves canonical drift baselines,
and distinguishes placeholders from concrete caller/default values. Core
generation uses a shared import batch for uniqueness reservations.

Imports preserve source bytes, configuration body content, metadata artifacts,
and conventional licensing/attribution files or directories. The specification
does not define discovery of arbitrary legal material under other names; the
filename convention is not a claim of complete legal-file discovery.

Source and destination cannot overlap, including through a junction alias.
Snapshot metadata retains blocked link paths; import rejects metadata links.
Strict validation and intended note-type association are checked before a staged
target is published. Optional Authoring generators are explicitly rejected when
generation is needed; this is not an optional-generator execution capability.

The maintainer resolved definition-only scope on 2026-09-14: published artifacts
only; `both` also validates existing notes. Artifact snapshots preserve empty
metadata and explicit selected-path ancestors without including unrelated notes.
Definition models never expose live notes to consumers. Static query contracts
are distinct from evaluated rows; pending template references do not evaluate
sources. Invalid mapping declarations retain independent artifact checks, while
unread note semantics cannot claim complete coverage. Known-empty inventories
remain interpretable, including actual zero-note counts. Import still strictly
validates the completed target; source-note validity is not an import prerequisite.

Nested link checks now traverse declared objects/lists while retaining stored
presence and top-level relationship boundaries. Unknown-field findings omit an
optional field context when a complete portable field path cannot represent its
name; source names remain in messages. These corrections do not finish the
remaining Markdown-consumer or schema-checker parity audits.

Direct note-link parsing now retains its exact input and lexical label/fragment
components without changing target processing. HTML-contained links are extracted
without replacing source characters. The guarded, isolated Marked seams and
performance regression are documented in the
[source-preservation decision](../../docs/decisions/003-note-link-source-preservation.md).
The subsequent [body-span implementation](../../docs/decisions/004-body-link-source-spans.md)
now adds exact physical UTF-16 source ranges while retaining logical parser input.
It captures original CommonMark block offsets, preserves reader body line endings,
and corrects escaped-label phantom links and invented HTML reference/code exclusions.
Encoded-anchor interpretation remains an open clarification; preserving authored
spelling is not a claim to have resolved that policy.

Markdown destination escapes/entities are now processed before scheme/fragment
detection and one target percent-decoding pass. This prevents false external-link
relationships and maps lexical anchors back to authored delimiters; see the
[decoding decision](../../docs/decisions/005-markdown-destination-decoding.md).
Malformed percent triplets now remain in source-located body inspection failures
and the relationship graph. Managed-field syntax uses the `CM-54` note-link
category without a duplicate generic format error, while other field constraints
and nested siblings remain checked. Suppression does not unlock dependent queries;
see the [diagnostic decision](../../docs/decisions/006-note-link-diagnostics.md).
Shared non-repairing RFC 3986 syntax checks now cover URI fields and pre-fragment
Markdown targets, including authorities, encoded octets and component-specific
punctuation. URI fields no longer rely on WHATWG repairs or transport port bounds.
A linear scanner removes the review's reproduced regex-engine size limit; see the
[URI syntax decision](../../docs/decisions/007-rfc-uri-syntax.md).
The maintainer subsequently resolved URI-field fragments, decoded Markdown-anchor
interpretation and non-UTF-8 note-target rejection; see
[decision 016](../../docs/decisions/016-unicode-note-link-components.md).
General raw-fragment character checks and reference-style outer links remain
separate work; the new decoding step does not claim those boundaries are complete.
The measured escaped-character/block-mask and extension-start bottlenecks are now
fixed by an extraction-only lexer; it omits emphasis rendering work while retaining
link, escape, code-span, HTML and unescaping behavior. This also corrects astral
mask truncation and incorrect backtick boundaries. At 600 KB, the
measured destination/prose cases fell from roughly 17.8/30.1 seconds to below
0.1/0.2 seconds. Independent CommonMark/source review and timing guards cover the
change; see the [inline-lexer decision](../../docs/decisions/008-extraction-only-inline-lexer.md).
This is not an exhaustive parser-performance or remaining Core-conformance claim.

A suspected complete-field-name schema gap was checked against the actual current
registry: ordinary names/paths pass and their final-LF variants fail. No schema
change was justified by that probe. Broader checker parity remains under audit.

The specification fixture checker now rejects native YAML sets and ordered maps
in structural mapping positions, matching the runtime without restricting opaque
vendor metadata. Both use iterative shape projection; the runtime's reproduced
20,000-level opaque-graph stack overflow is fixed. Thirty specification regressions,
eight new tooling cases and four artifact fixtures cover tags, aliases, prototype
keys, live diagnostics, examples, golden-vector bytes and deep graphs. See the
[checker-parity decision](../../docs/decisions/009-yaml-shape-checker-parity.md).

The separate `allowed_values` crash is now addressed by mirroring FDR-197's existing
scalar-only item shape in the shared schema. Invalid mappings/sequences no longer
reach AJV's object comparison, including authored method-like keys, null-prototype
objects and distinct cycles. Review caught a prototype-like string duplicate missed
by AJV's scalar hash; guarded, separate uniqueness avoids that optimization.
Twenty-five schema and twenty collection/query regressions plus seven artifact
fixtures cover the correction. Scalar compatibility and normalized equality remain
semantic, and opaque aliases/source bytes are retained;
see the [boundary decision](../../docs/decisions/010-scalar-allowed-values.md).
This is not a general cyclic-equality implementation or completion of the remaining
Core audit, checker input-boundary audit or open URI-policy dispositions.

The subsequent input-boundary correction aligns CR-only frontmatter and strict
UTF-8 reads in the fixture checker, including artifact bodies and JSON strings.
Top-level tagged sets no longer masquerade as optional frontmatter mappings.
Runtime byte/text parsing now consumes one leading BOM consistently, without
hiding a delimiter behind a second BOM. Thirty checker and fifteen runtime
regressions retain exact delimiters, opaque nested tags, binary assets, interior
BOMs and source bytes. JSON BOM behavior and discovery are unchanged; see the
[input-boundary decision](../../docs/decisions/011-text-input-boundaries.md).
The original three-case byte probe now agrees across both readers. The remaining
Core, compatibility and effort audits are not closed by these parser corrections.

The FND-25 directive gap is now corrected with explicit Core resolution settings,
not just a default version. Legacy words/numeric forms, implicit merge-looking
keys and duplicate detection retain their Core meanings even with `%YAML 1.1`.
Explicit known tags, aliases and source bytes remain supported. Thirty checker
and thirty-three runtime regressions, two golden vectors and two artifact fixtures
cover the correction; see the [fixed-Core decision](../../docs/decisions/012-fixed-yaml-core.md).

Runtime JSON ingress now uses fatal decoding at all five file-read sites: CLI
queries, expected reports, query cases, negotiation contexts and schema registration.
Twenty-six regressions/control cases reject repaired-input false positives while
preserving valid Unicode, source bytes, JSON syntax/BOM behavior and operational versus
semantic errors; see the [JSON-input decision](../../docs/decisions/013-strict-json-inputs.md).
Migration readiness retains its existing generic manual-resolution wrapper for
loader failures; a regression proves malformed schema bytes cannot approve a no-op.
The full Core, capability, compatibility and measured-effort completion checks remain
open; these input corrections do not substitute for the requirement ledger.

The E1/EXT-27 root rewrite now retains parsed YAML nodes instead of round-tripping
through JavaScript. Native tagged values, unknown tags, complex mapping keys and
source-root aliases survive the identity change. Root merge entries are expanded
before removing publishing fields; source bytes, copied artifacts and body remain
unchanged. Dedicated regression tests, not a successful target report or the
ordinary example, establish these cases. See the
[root-preservation decision](../../docs/decisions/014-root-yaml-preservation.md).
Scalar source text also survives native Number/Date precision limits. A remaining
E1 operability gap affects highly shared source-root graphs: the new aliases can
exceed the reader's expansion budget. Imports fail closed with source unchanged
and no target published; the safety limit is not disabled. Resolve that interaction
without corrupting metadata or weakening resource protection. This is not general
writer fidelity: scaffold serialization remains a separate audit target.

The terminal YAML reader loss is now corrected in both runtime and fixture checker,
including classified YAML/YML fences. Final keep-chomp scalars retain all content
newlines, while exact delimiters, body extraction, Core resolution and alias guards
are unchanged. Scaffold serialization also stops trimming significant terminal
YAML content. Regression tests and two constant-comparison golden vectors cover
the correction; see the [newline decision](../../docs/decisions/015-terminal-yaml-newlines.md).
The shared-root graph budget still requires work. A separate valid-source scaffold
probe confirms native-value loss in declared `any` fields: Set, ordered Map, Date
and binary inputs become arrays, ordinary mappings or text in an accepted target.
The source bytes remain unchanged, but this is not a faithful materialization.
Scaffold value/tag/alias preservation remains uncommitted: three review cycles
still leave merge-context failures, including an import reporting success while
leaving an intended child default unchanged. That implementation is paused for
maintainer direction under the review bound; it is not included in published
runtime evidence. The independent [read-only lifecycle audit](lifecycle-read-audit.md)
adds integrated deletion/archive checks against the committed runtime. The broader
Core/capability, effort and release audit remains open.

The separate root-budget investigation now has a valid source with 98 flat
aliases that needs a budget of 99 before import and 198 afterward under the
current identity-preserving emitter. Reordering fixes some DAG examples but
cannot remove that emitter's duplicated references across the two roots.
Merge hoisting passed the guard only by splitting cross-root object identity.
These are bounded findings, not a proof against every YAML encoding; no resource
guard was changed and no ordering-only fix is claimed complete.

The accepted Unicode/URI decisions now have a source-preserving interpretation
helper, strict internal component decoding, and valid/invalid/suppressed golden
vectors. URI-field fragments and arbitrary well-formed encoded octets remain
valid. The existing raw-fragment character-validation conflict is explicitly
still open, as are the unrelated YAML writer and measured-effort requirements.

## Completion evidence still required

1. Resolve known implementation gaps and audit the plan's named Core concerns.
2. Run the exact-revision tooling tests, typecheck, dependency audit and
   conformance command; record actual output rather than infer it from fixtures.
3. Run the specification regression, fixture, rule-ID and site gates. Preserve
   Core 600-rule/150-per-page/20,000-word and Reuse 100-rule ceilings.
4. Verify source/specification/evidence revisions, offline example output,
   unchanged source snapshots, and all remaining release dispositions.
5. Update the coordinating and related tickets without closing separate
   follow-ups. Mark the overall goal complete only after the ledger is proven.
