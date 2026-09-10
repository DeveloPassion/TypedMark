# TypedMark 0.1.0 conformance evidence

This record covers seventeen golden vectors at TypedMarkSpecification
`2b1402f0bb1fdeeb9523b36c298303edbdd1c273`, using adapter
`bed70c39db2036cdddd6780c6adba220040f84c9` on 2026-09-10.

Results:

- fourteen eligible collection vectors passed;
- six standalone query cases passed, including expected semantic failures;
- zero collection path or byte changes;
- zero unexpected validation or query failures;
- one broader vector remains unsupported (Automation); and
- two historical negotiation cases were not run because their precondition,
  unsupported Views, no longer applies to this adapter.

Collection-validation capabilities now include Reuse, Queries, Views, and the
bounded Systems contract. Standalone query execution remains separately
advertised under `operations`. The existing explicit-property-set vector now
runs, alongside new positive composition and negative conditional-constraint
vectors. Notes, queries, datasets, views, and relationship cardinality share
one effective schema model within the captured collection snapshot.

Unavailable model or body contracts prevent full interpretation. They are not
misreported as invalid dataset content, and their dependent supported contracts
are not claimed as fully evaluated. Version findings identify the actual
unsupported root or schema rather than an otherwise supported consumer.

Run the suite with:

```powershell
bun run conformance --spec ..\TypedMarkSpecification
```

Validation covered 191 tooling tests, type checking, dependency audit,
321 specification tests, 242 fixture expectations, rule-ID checks, and the
31-page site build. The test command allows 30 seconds per
filesystem integration case and 90 seconds for the whole vector-suite case;
these are correctness checks, not timing benchmarks.

Independent review covered composition order, 6,000-level inheritance,
conditional constraints, capability claims, version routing, diagnostic
origins and severities, and abstract relationship counting. These results advance
issue #123's B4/E2 work; they do not establish coverage of every normative rule
or completion of the five-working-day full-validator measurement.

Content-expansion query surfaces, Expressions, and Automation remain
follow-up work. The earlier TypedMarkExample system exercise at `f2c7f14`
was not rerun for this Reuse validation slice.
