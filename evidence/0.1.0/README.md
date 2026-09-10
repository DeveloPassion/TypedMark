# TypedMark 0.1.0 conformance evidence

This record covers fifteen golden vectors at TypedMarkSpecification
`0a33553000e0b20d4c3bf62ce2adf2f41c9d6bfd`, using adapter
`4c960e5e867ae5e0b46346e79393a7e92b30f1ea` on 2026-09-10.

Results:

- eleven eligible collection vectors passed;
- six standalone query cases passed, including expected semantic failures;
- zero collection path or byte changes;
- zero unexpected validation or query failures;
- two broader vectors remain unsupported (Reuse and Automation); and
- two historical negotiation cases were not run because their precondition,
  unsupported Views, no longer applies to this adapter.

Collection-validation capabilities now include Queries, Views, and the bounded
Systems contract. Standalone query execution remains separately advertised
under `operations`. `views-valid` and `views-invalid` exercise datasets,
dataset-backed views, embedded queries, row identities, presentation references,
and board values. Dataset results are shared within one captured model.

Unavailable model or body contracts prevent full interpretation. They are not
misreported as invalid dataset content, and their dependent supported contracts
are not claimed as fully evaluated. Version findings identify the actual
unsupported root or schema rather than an otherwise supported consumer.

Run the suite with:

```powershell
bun run conformance --spec ..\TypedMarkSpecification
```

Validation covered 134 tooling tests (the full 133-test suite plus the final
undeclared-view-field regression and targeted view rerun), type checking,
dependency audit, 321 specification tests, 240 fixture expectations, rule-ID
checks, and the 31-page site build. The test command now allows 30 seconds per
filesystem integration case and 90 seconds for the whole vector-suite case;
these are correctness checks, not timing benchmarks.

Independent review covered snapshot reuse, capability claims, version routing,
unavailable model contracts, and diagnostic origins. These results advance
issue #123's B4/E2 work; they do not establish coverage of every normative rule
or completion of the five-working-day full-validator measurement.

Content-expansion query surfaces, Reuse, Expressions, and Automation remain
follow-up work. The earlier TypedMarkExample system exercise at `f2c7f14`
was not rerun for this dataset/view validation slice.
