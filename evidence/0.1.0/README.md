# TypedMark 0.1.0 conformance evidence

This record covers the thirteen golden vectors at TypedMarkSpecification
`5e26ccc132aeea084ef3265f5b5e2623721422a5`, using adapter
`0ebf047eed31870d81763ab689f525e674a6dfc8` on 2026-09-10.

Results:

- eleven eligible collection vectors passed;
- six standalone query cases passed, including their expected semantic failures;
- zero collection path or byte changes across validation and query execution;
- zero unexpected query or validation failures; and
- two broader collection vectors remain unsupported because Reuse, Views,
  and Automation are not implemented.

Capabilities distinguish collection validation (`extensions`) from standalone
execution (`operations`). Queries are advertised only as operations at
`0.1.0`; embedded-query validation is still unsupported. The query pilot's
collection is Core-only, and each operation supplies its exact query-contract
version without changing collection declarations.

The query cases cover effective defaults versus stored presence and projection,
relationship predicates, ordering, limiting before grouping, logical-deletion
selection, conditional conversion failure, and invalid boolean children.
The harness compares evaluation, ordered rows/groups, alias order, and expected
failure rules. Actual results retain provenance; separate regression tests cover
its classification and read-only boundaries.

Run the evidence suite with:

```powershell
bun run conformance --spec ..\TypedMarkSpecification
```

Validation included 105 tooling tests, type checking, dependency audit,
321 specification tests, 238 fixture expectations, the rule-ID gate, and the
31-page site build. Independent review findings have regression coverage,
including immutable snapshot reads, heterogeneous grouping, empty-result mapping
checks, and related-note version interpretation.

This continues specification issue #123's standalone pilot work toward B4.
Embedded-query validation and broader B4/E2 optional-contract coverage remain
open. The original Core adapter and the subsequent negotiation and query work
were each bounded working sessions; these results do not establish that every
normative rule is implemented or measure a complete Core validator against the
five-working-day target.

The earlier companion system exercise remains at TypedMarkExample commit
`f2c7f14`. It records instantiation, offline validation, publishing-identity
removal, provenance, and absent-history behavior. It was not rerun for this query
evidence refresh.
