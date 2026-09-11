# TypedMark 0.1.0 conformance evidence

This record covers nineteen golden vectors at TypedMarkSpecification
`c854e3ce0d7c00a0076297a1257201155dd9a0be`, using adapter
`fa08ec9ad22b821e2964b16fa0ecdb7fce968fe0` on 2026-09-11.

Results:

- seventeen eligible collection vectors passed;
- six standalone query cases passed, including expected semantic failures;
- zero collection path or byte changes;
- zero unexpected validation or query failures;
- no vector was skipped for an unsupported validation contract; and
- two historical negotiation cases were not run because their precondition,
  unsupported Views, no longer applies to this adapter.

Collection-validation capabilities include Reuse, Queries, Views, Expressions,
Content Expansion, Automation artifacts, and the bounded Systems contract.
Standalone query execution remains separately advertised under `operations`.
The existing optional-artifact vector now runs, alongside new positive and
negative combined derived-contract vectors. Notes, queries, datasets, views,
expansion sources, and automation references share the captured effective model.

Computed fields remain stored fields, not virtual replacements. Expansion checks
respect stored source values, per-row numeric types, pending-template timing,
and completed-once semantics. Automation validation checks declarations and
action compatibility only: no event matching, scheduling, action execution,
propagation, destructive approval, expansion refresh, or note writes are claimed.

Unavailable model or body contracts prevent full interpretation. They are not
misreported as invalid dataset content, and their dependent supported contracts
are not claimed as fully evaluated. Version findings identify the actual
unsupported root or schema rather than an otherwise supported consumer.

Run the suite with:

```powershell
bun run conformance --spec ..\TypedMarkSpecification
```

Validation covered 282 tooling tests, targeted final Unicode path regressions,
type checking, dependency audit, 321 specification tests, 244 fixture expectations,
rule-ID checks, and the
31-page site build. The test command allows 30 seconds per
filesystem integration case and 90 seconds for the whole vector-suite case;
these are correctness checks, not timing benchmarks.

Independent review covered expression scope and Unicode transforms, CommonMark
marker boundaries, stored-value timing, source-local version availability,
per-row numeric conversion, automation references and protected fields, nested
unknown-key policy, and Unicode-safe storage matching. These results advance
issue #123's B4/E2 work; they do not establish coverage of every normative rule
or completion of the five-working-day full-validator measurement.

Automation execution, writer operations, extended authoring, and template
tracking remain follow-up work. The earlier TypedMarkExample system exercise
at `f2c7f14` was not rerun for this read-only derived-contract validation slice.
