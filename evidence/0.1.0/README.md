# TypedMark 0.1.0 conformance evidence

This record covers twenty-four golden vectors at TypedMarkSpecification
`04a6c7a7061ced0e15f9464e7c7c590e4e47091e`, using adapter
`ccef2b137b79ceba79463c4e8de4803e30b483e9` on 2026-09-11.

Results:

- twenty-two eligible collection vectors passed;
- nine standalone query cases passed, including expected semantic failures;
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

The Core audit adds regression coverage for default Git exclusions, full-path
Unicode globs, protected metadata, and safe subtree pruning. Ordered association
now preserves the first winner, including invalid dynamic candidates, and
checks declarations even with no notes. Stored predicates share exact YAML-value
comparison while preserving the distinction between absent and empty frontmatter.
Association availability is independent of diagnostic suppression. The parser
recognizes unclosed delimiters as body content, rejects invalid UTF-8 without
replacement, and keeps YAML alias limits inside structured diagnostics. These
are implementation corrections; no normative prose or artifact shape changed.

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

Validation covered 432 tooling tests, type checking, dependency audit,
321 specification tests, 249 fixture expectations, rule-ID checks, and the
31-page site build. The test command allows 30 seconds per
filesystem integration case and 90 seconds for the whole vector-suite case;
these are correctness checks, not timing benchmarks.

Independent review covered exclusion pruning, metadata resolution, mapping
order, declaration availability, stored/effective predicate separation, Unicode
field-name matching, parser error boundaries, and the new golden reports.
These results advance B4/E2 in
[specification #123](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123);
they do not establish coverage of every normative rule
or completion of the five-working-day full-validator measurement.

Automation execution and writer operations remain follow-up work. Read-only
system-definition validation of TypedMarkExample at
`c55578d0ee6996cc82efeda80b7d60cae3ba591b` passed with complete evaluation and no
findings. The earlier full instantiation/offline-validation/migration exercise
was not rerun for this slice.
Lossless note re-typing is separately tracked for future design in specification
[#130](https://github.com/DeveloPassion/TypedMarkSpecification/issues/130).
