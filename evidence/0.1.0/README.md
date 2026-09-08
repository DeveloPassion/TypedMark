# TypedMark 0.1.0 conformance evidence

This record covers the six golden vectors checked into TypedMarkSpecification at
`9d8b828c4b4895818983f3077e4fc981275d8bb2`. They were selected by adapter commit
`026d61346ec7682994744ae6d25b92942d55e38d` on 2026-09-08.

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
