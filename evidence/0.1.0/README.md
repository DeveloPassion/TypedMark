# TypedMark 0.1.0 conformance evidence

This record covers thirty-nine golden vectors at TypedMarkSpecification
`4d61db140c045bc2f2a5d6af00f38ca3330000cd`, using adapter
`e48bc7ba71cec4263f0cfd5e6adfe6c5112f1777` on 2026-09-14.

The recorded JSON is the unmodified conformance output from the successful
[pinned CI run](https://github.com/DeveloPassion/TypedMark/actions/runs/34822253548),
which ran the repository's conformance command against these exact revisions.

Results:

- thirty-seven eligible collection vectors passed;
- eleven standalone query cases passed, including expected semantic failures;
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
were implementation corrections without normative prose or artifact shape changes.

Uniqueness now uses the shared type-aware equality domain, with collection-wide
same-name/same-property-type scope derived from concrete schema declarations.
The count-range implementation was already present; new regressions and vectors
verify it independently of note population. History now selects its own Core
artifact version, preserves best-effort incompleteness, and reports specific
shape/provenance diagnostics. Readiness uses one strict, immutable snapshot and
does not mistake suppressed errors or history availability for migration impact
analysis: only a validated version no-op can be ready.

History ordering now enforces the accepted strict SemVer precedence policy in
`SCE-99`: equal precedence is rejected even when build metadata differs.
Prerelease identifiers use numeric or ASCII comparison as appropriate, including
numbers beyond JavaScript's safe integer range. Build metadata is ignored only
for ordering; the final exact-version check remains unchanged. The positive and
negative history-order vectors exercise this policy without rewriting history.

Best-effort diagnostics for schemas, property sets, and history now require an
actual, complete version string on the supported line with a newer patch.
Malformed prefixes, suffixes, trailing line terminators, and non-string values
cannot downgrade structural errors or crash validation through string coercion.
Thirty additional regressions cover
schemas, property sets, query eligibility, and history. Valid newer patches
remain incomplete with warnings; unsupported lines remain unavailable. These
are implementation corrections under the existing version contract, with no
specification or schema changes and no additional golden vectors in this slice.

Core field coverage now includes stored identifier nullability, intrinsic alias
restrictions and defaults, and normalized mandatory-tag declarations/membership.
Storage checks distinguish intrinsic pattern syntax from references resolved
after concrete composition. Missing or unsafe path inputs produce findings;
literal text containing `undefined` has no sentinel behavior. Unformatted scalar
substitution stays separate from field-type validation. Formatted date values
use the collection timezone and ISO week-year, and archive patterns replace the
active branch. Invalid configuration remains unavailable to queries even when
its diagnostics are suppressed.

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

Validation covered 601 tooling tests in CI, type checking, dependency audit,
321 specification tests, 264 fixture expectations, rule-ID checks, and the
31-page site build. The test command allows 30 seconds per
filesystem integration case and 300 seconds for the whole vector-suite case;
these are correctness checks, not timing benchmarks.
The affected artifact/history suite passed all 77 tests independently. The
local full-run attempt timed out in the unchanged query pilot and was stopped.
That pilot then passed unchanged in isolation; the pinned CI run completed all
601 tests with no failures. No test deadlines were changed for this slice.
The specification verification counts above remain those established at the
unchanged specification revision.

Independent review covered exclusion pruning, metadata resolution, mapping
order, declaration availability, stored/effective predicate separation, Unicode
field-name matching, parser error boundaries, Core field invariants, deferred
storage references, timezone failures, type-aware uniqueness, history version
boundaries, strict snapshot readiness, release precedence, malformed/non-string
artifact version handling, and the golden reports. The earlier ordering review
also checked 193,600 pairs of 440 schema-valid versions against an independent
BigInt/ASCII comparator, including 1001-digit identifiers; all comparisons agreed.
These results advance B4/E1/E2 and the bounded system-exercise part of E3 in
[specification #123](https://github.com/DeveloPassion/TypedMarkSpecification/issues/123);
they do not establish coverage of every normative rule
or completion of the five-working-day full-validator measurement.

General automation execution and writer operations remain follow-up work.
The [2026-09-11 bounded system exercise](system-exercise.json) used TypedMarkExample
`c55578d0ee6996cc82efeda80b7d60cae3ba591b`: source validation, instantiation into
an isolated temporary directory, and a separate offline validation all completed
with no findings. The instance omitted publishing `version`/`scaffold`, recorded
its composition source, and materialized `Notes/Welcome.md`. The source snapshot
was unchanged; the temporary instance was removed after verification. Missing
history still returned `manual_resolution_required`, with no migration attempted.
That historical exercise was not rerun for this slice; current readiness changes
are covered by the tooling regression suite. History replay, target-aware impact
analysis, and broader composition remain follow-up work.
Lossless note re-typing is separately tracked for future design in specification
[#130](https://github.com/DeveloPassion/TypedMarkSpecification/issues/130).
