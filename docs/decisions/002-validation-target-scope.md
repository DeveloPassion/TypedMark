# Validation target scope

Status: accepted and implemented on 2026-09-14; release evidence tracked in the plan audit.

The selected `system_definition` target evaluates published artifacts only.
Existing collection notes belong to `instantiated_collection`; `both` combines
the two targets. The authoritative target contract is in the specification's
Conformance and Roadmap page, with the definition artifact set owned by Systems.

The implementation separates snapshot selection from model interpretation.
Artifact snapshots retain configuration, metadata and explicitly included
licensing material. Unrelated note changes do not invalidate that snapshot.
Definition models expose no existing notes to dataset, expansion or tracking
consumers. Static schema, template, scaffold, history and optional-artifact checks
remain active; a definition report does not certify current or future note rows.

Import validates the published source and then strictly validates its completed
target as an instantiated collection. It does not copy or approve existing
source notes. Migration readiness remains a bounded validated-version no-op,
not migration impact analysis.

Implementation checkpoints:

1. Add an opt-in artifact snapshot scope, preserving empty metadata directories,
   selected-path ancestors and link rejection. Verify snapshot stability tests.
2. Clarify existing mode rules and select note evaluation by target. Verify
   malformed existing notes are ignored only for definitions, while static
   artifacts and newly materialized targets remain checked.
3. Close inherited static-reference and early-return coverage gaps. Verify
   pending templates resolve artifact references without reading source values,
   and unperformed checks cannot be reported as fully evaluated.
4. Run repository gates and target-mode vectors; record exact CI revisions and
   update specification #123 without claiming the remaining plan is complete.

Static query analysis exposes projected contracts, not synthetic empty row
results. Pending template sources use those contracts independently of live-row
failures. Invalid mappings retain inventory discovery and independent artifact
checks: known-empty note inventories remain interpretable, while unread notes
make Core and the affected note-consuming extensions incomplete. Declaration-only
Authoring, Systems and Automation checks retain their evaluated status.
