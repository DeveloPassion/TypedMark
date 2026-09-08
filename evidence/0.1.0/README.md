# TypedMark 0.1.0 conformance evidence

This record covers the six golden vectors checked into TypedMarkSpecification at
`155d668d46c2912244d345fa5ff417a71bac07ac`. They were selected by adapter commit
`d109e4f45a09984c8f509e7f9019eacea02093c4` on 2026-09-08.

Results:

- four eligible vectors executed and matched every expected machine-stable report field;
- zero vector failures;
- zero collection path or byte changes during validation;
- Core-only valid and invalid cases passed;
- the unsupported `example:review@1.2.0` negotiation pilot remained incomplete
  and invalid; and
- two normal vectors were not run because their required Reuse, Queries, Views,
  and Automation contracts are not advertised by this adapter slice.

Run the evidence suite from this repository with:

```powershell
bun run conformance --spec ..\TypedMarkSpecification
```

The implementation and evidence were completed within one working session on
2026-09-08, below the five-working-day target for this adapter slice. This is not
evidence that every one of the specification's 1,708 active rules has a dedicated
semantic vector: it proves the six currently checked-in capability-scoped vectors.
Additional conformance claims must name their applicable vector inventory.

The companion system exercise uses TypedMarkExample commit `f2c7f14` and verifies
system-definition validation, self-contained instantiation, offline validation,
publishing-identity removal, provenance recording, and refusal to guess an update
when `history.md` is absent.
