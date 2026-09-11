# TypedMark 0.1.0 conformance evidence

This record covers twenty-one golden vectors at TypedMarkSpecification
`6238f53cf9f2f3d0d98257e6f29e047429395533`, using adapter
`66fe00bf1f0563187d2d3824de169cf4619bb7c4` on 2026-09-11.

Results:

- nineteen eligible collection vectors passed;
- six standalone query cases passed, including expected semantic failures;
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

Validation covered 339 tooling tests (the 338-test aggregate plus the final
unselected-vocabulary regression), type checking, dependency audit,
321 specification tests, 246 fixture expectations, rule-ID checks, and the
31-page site build. The test command allows 30 seconds per
filesystem integration case and 90 seconds for the whole vector-suite case;
these are correctness checks, not timing benchmarks.

Independent review covered recursive Authoring activation, Core diagnostic
independence, generator constraints, compatibility-preserving parser extraction,
region digests and classification, per-ID structural suppression, canonical
availability, and the new golden reports. These results advance
issue #123's B4/E2 work; they do not establish coverage of every normative rule
or completion of the five-working-day full-validator measurement.

Automation execution and writer operations remain follow-up work. The earlier
TypedMarkExample system exercise at `f2c7f14` was not rerun for this slice.
Lossless note re-typing is separately tracked for future design in specification
[#130](https://github.com/DeveloPassion/TypedMarkSpecification/issues/130).
