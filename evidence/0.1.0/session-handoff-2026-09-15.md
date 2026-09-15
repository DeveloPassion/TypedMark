# Session handoff — 2026-09-15

The maintainer requested session wrap-up and draft PRs, not further implementation
or merges. The objective remains **finish implementing the full refocus plan** in
[specification #123](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123).
This is non-normative evidence, not a release approval or a narrowed replacement plan.

## Verified main and saved work

Verified main: specification `8e7929b9191bf4494dd1a51482043a2784078afe`;
tooling `e87872c0f5961638a69410872d7625d267c02391` (runtime `7583ab1`);
example `c55578d0ee6996cc82efeda80b7d60cae3ba591b`.
Main evidence: 1,788 tooling tests; 471 specification tests; 317 fixture
expectations; 1,708 rule IDs; 76 vectors / 74 eligible passes / 17 query passes;
successful separate-process offline example; passing source/evidence/spec CI.
Two historical unsupported-Views preconditions are explicitly not run.

| Draft PR | Branch | Saved state |
| --- | --- | --- |
| [Specification #131](https://github.com/DeveloPassion/TypedMarkSpecification/pull/131) | `wip/fragment-encoding-20260915` | Fragment encoding prose/fixtures, `f873d8d`; paired with tooling #4. |
| [Tooling #4](https://github.com/DeveloPassion/TypedMark/pull/4) | `fix/fragment-encoding-20260915` | Implementation `d12095f` plus this handoff; CI pins spec draft `f873d8d6cab37def9c806758fb58cccf66776628`. |
| [Tooling #5](https://github.com/DeveloPassion/TypedMark/pull/5) | `wip/scaffold-yaml-20260915` | Previously uncommitted native scaffold YAML work, `573a002`; known wrong-output cases remain. |
| [Tooling #6](https://github.com/DeveloPassion/TypedMark/pull/6) | `fix/root-budget-20260915` | Root-budget probe and intended-success tests, `e3d4caa`; no production change. |

All are drafts. These independent workstreams are not a stack to merge wholesale.
The verified main branches were not advanced during wrap-up.

## Accepted decisions — do not ask again

- Unreleased 0.1.0 draft; prior 0.0.1 access retained. Inheritance/property-set
  composition belongs to Reuse; vocabularies remain Core.
- `system_definition` checks published artifacts; `both` also checks notes.
- Reject equal SemVer precedence in history, including build-only differences.
- Malformed extensions retain valid entries and remain incomplete even when
  diagnostics are suppressed.
- Markdown anchors decode before interpretation; non-UTF-8 internal components
  produce `invalid_note_link` under NL-11; malformed escapes remain NL-6.
- URI fields allow scheme-qualified fragments and arbitrary well-formed encoded
  octets under their distinct RFC grammar.
- Latest decision: Markdown anchors require RFC percent encoding, retaining one
  leading `^` block marker. The policy is settled; #131/#4 are unfinished delivery.
- Lossless note re-typing remains deferred in specification #130.

## Full plan status

The original D1–D4 agendas, A1–E4 criteria and original-item traceability remain
in #123. Implemented foundations are not a claim of exhaustive coverage.

| Package | Current state / remaining check |
| --- | --- |
| D1 release/compatibility | Draft/version boundary established; final compatibility and release dispositions remain. |
| D2 Core/Reuse/capabilities | Accepted ownership and report seam implemented; complete truthful scope audit. |
| D3 values/writes | Effective values, optional templates and Core fields implemented; native scaffold fidelity remains in #5. |
| D4 portable interpretation | Boundary/path/heading/time foundations implemented; finish fragment drafts and other Markdown-consumer checks. |
| A1 | Historical inventory/gates verified; not effort measurement. |
| A2 | Rule identity, ownership and retirement infrastructure present; retain final registry/report alignment. |
| A3 | Classified examples and fixture integrity present; final exact-revision gates remain. |
| A4 | Snapshot/report/vector runner present; separate read-only and writer evidence. |
| B1–B4 | Declaration/report seam, shared prerequisites, query extraction and executable pilot implemented; retain exact-revision evidence. |
| C1–C4 | Reuse/optional modules/automation/Systems ownership extracted; finish dependency and coverage audit. No general executor, replay or external composition claim. |
| D5 | Effective fields/templates/import foundation present; finish #5 value/tag/alias materialization. |
| D6 | Discovery/path/CommonMark/time work present; finish #131/#4, then reference-style outer links and remaining consumers. |
| D7 | Identity/merge/tags/archive/untyped suites and 40 lifecycle checks present; finish concern-by-concern audit. |
| D8 | Simplifications and retained count/object constraints documented; verify every incompatibility's migration/manual-resolution disposition. |
| D9 | Feature moves/removals documented; finish compatibility review without inventing equivalence or preservation claims. |
| E1 | Main bounded import/offline example passes; #5 and #6 remain correctness/operability work. |
| E2 | Main corpus verified; draft adds three vectors and one query; full capability-scoped audit remains. |
| E3 | Executable spike/example exists; historical hands-on effort unavailable. Obtain measurement or explicit ADR disposition, not commit-date/runtime inference. |
| E4 | Docs/navigation/budgets/prior links present; final compatibility/release review remains. No release authorized. |

General writers/backlink repair, inverse synchronization, automation execution,
new features and companion transfers remain separate follow-ups as #123 specifies.
Do not close #18, #72, #78 or #130 merely because adjacent validation exists.

## Resume anchor encoding first

Check the current PR heads and CI, then use BOTH paired branches in sibling
checkouts. Local tooling tests resolve `../TypedMarkSpecification`; main's older
fixture corpus is not the correct input for the fragment branch. Read repository
guidance first. Never reset dirty work or restart a live CI job only because a
poll timed out.

Verified locally in the drafts: 44 new tests/175 assertions; a 243-test overlapping
focused group; three vector integrations; typecheck; 320 fixture expectations;
1,708 rule IDs; Core 600/600, Reuse 94/100, reading path 19,993/20,000.
Static review found no required issue. No independent review test run or
cross-model review was performed. No tests or resource guards were disabled.

Remaining before merge:

1. Tooling: `bun run test`, `bun run typecheck`, `bun audit`, and
   `bun run conformance --spec ../TypedMarkSpecification`; inspect latest PR CI.
2. Specification: `bun run test`, `bun run validate-fixtures`,
   `bun run lint-rule-ids`, and `bun run build-site` at the final revision.
3. Update README, decision 016 and evidence to supersede the former open
   raw-fragment policy; add final decision documentation as appropriate.
4. Record actual exact-revision conformance and offline-example output. Expected
   draft live corpus: 79/77/18, with two historical precondition skips. Checked-in
   evidence still truthfully records main's 76/74/17 until refreshed.
5. Review, coordinate the spec/tooling merge order, and update #123/#30/#43.
   The full plan stays open until all original requirements are verified.

## YAML blockers and reproductions

Tooling #5: current typecheck passes; focused reproductions are 0 pass / 4 fail
(14 assertions). Inherited collection/null keys change names when moved directly;
native set merge projection disagrees with the reader; one successful-looking
import leaves a child default unchanged. Detached merge-key aliases also have a
fail-closed limitation. Reproduce:

```powershell
bun test ./tests/yaml-values.test.ts ./tests/scaffold-yaml-values.test.ts --test-name-pattern 'intended field name|merged names|native set used|actually assigned' --timeout 30000
```

The prior doubt-driven review reached three cycles. Obtain direction and
revise/decompose the approach before further review; the savepoint is not
approval to ship it. Preserve failing tests and source values/sharing.

Tooling #6: `bun test ./tests/root-alias-budget.test.ts --timeout 30000` gives
2 pass / 2 fail / 359 assertions. `bun scripts/probe-root-budget.ts` records
ordering-sensitive DAG cases, the flat 98-alias source budget 99/output 198,
and merge hoisting that passes the guard while splitting cross-root identity.
These are bounded encoding findings, not universal impossibility. Production
guards are unchanged; higher probe limits only measure required budgets.

## Stop state

All unfinished work is pushed in draft branches. No draft was merged and no
release was made. Resume implementation when the maintainer requests it.
