# Refocus plan completion audit

This is non-normative implementation evidence for
[#123](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123), not a
replacement specification. The active objective remains **finish implementing
the rest of the plan**. A passing test count is not proof of full completion.

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
| A1 baseline | Historical commit and recorded rule/word/page totals in the release-decision comment | Re-establish durable access to the prior contract and verify the recorded inventory is reproducible. |
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
| D7 identity/merge/tags/archive/untyped | Core field, uniqueness, association, Reuse and storage suites | Audit each concern against its owner; the existence of tests alone does not close this row. |
| D8 simplifications | Removed-shape fixtures, retained count/object constraints, migration checklist | Verify each intentional incompatibility has a migration or explicit manual-resolution outcome. |
| D9 feature moves/removals | Reuse/Expressions/Authoring ownership; old folder-scope/generated forms rejected | Verify no undocumented equivalence or data-loss claim in the compatibility ledger. |
| E1 useful system path | One-source staged instantiation, local provenance, offline validation and strict readiness | Rerun the published example exercise on the final implementation; audit remaining import boundaries. |
| E2 conformance | Golden collection reports, query cases and tooling regressions | **Open:** complete the remaining Core audit and verify the required positive/negative scopes; no exhaustive claim yet. |
| E3 effort/spike | Executable implementation and historical bounded example exercise | **Open:** recorded hands-on effort before the current goal is not available; commit dates do not prove developer effort. Obtain the log/assessment or explicit ADR disposition. |
| E4 release/readability | Generated site, Getting Started, Quick Reference, audience metadata and enforced budgets | **Open:** final rendered reading-path/legacy-link review and release-policy audit. No release is approved by this file. |

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
