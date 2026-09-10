# TypedMark 0.1.0 conformance evidence

This record covers the twelve golden vectors checked into TypedMarkSpecification
at `a57d6e7d66b19870a6805e324f5a3e3661cab990`, using adapter commit
`5d8c583a4eaf68911f150a2bf7a51221f88d2139` on 2026-09-10.

Results:

- ten eligible vectors executed and matched every expected machine-stable report field;
- zero vector failures and zero collection path or byte changes;
- exact supported requirements and explicitly disabled requirements produced their
  respective complete and incomplete reports;
- unknown extensions, unsupported exact versions (including build suffixes),
  missing and conflicting dependencies, and undeclared Reuse produced the
  expected diagnostics; and
- two normal vectors were not run because their Reuse, Queries, Views, and
  Automation contracts remain unimplemented.

The evidence includes each run's requested extension scope. Negotiation
preconditions come from `vector.json` and are checked against advertised
capabilities; expected reports cannot manufacture an unsupported condition.
The declaration checks do not advertise new extension interpretation.

Run the evidence suite from this repository with:

```powershell
bun run conformance --spec ..\TypedMarkSpecification
```

This follow-up to specification issue #123 closes the tested declaration and
negotiation gaps in B1/E2. Validation included 55 tooling regressions, type
checking, and the dependency audit. The specification passed 318 regressions,
235 fixture expectations, the rule-ID gate, and the 31-page site build.

The original adapter checkpoint was completed in one working session on
2026-09-08; this negotiation follow-up was completed in one session on
2026-09-10. These measurements cover the bounded adapter slices, not a complete
implementation of every normative rule. B4's supported-query pilot and E2's
broader optional-contract coverage remain open.

The earlier companion system exercise uses TypedMarkExample commit `f2c7f14`
and records system-definition validation, self-contained instantiation, offline
validation, publishing-identity removal, provenance recording, and refusal to
guess an update when `history.md` is absent. It was not rerun as part of this
negotiation-only evidence refresh.
