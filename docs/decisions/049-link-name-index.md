# Link name index

Status: tooling follow-up to the view performance work (decision 048), 2026-10-31.

## Decision

After decision 048, reading the collection model was the largest cost: 7.5 to
18.7 seconds for a copy of the vault's 2,238 action notes. A CPU profile put
most of it in `resolveNoteLink`. Each name link scanned every document's
basename, and id and alias lookups scanned every managed note, so the work
grew with links times notes. Link resolution now uses an index of paths, names,
ids, aliases and asset names, built once per collection model. Resolution
rules are unchanged, ambiguity included.

## Interface

`linkIndex(model)` builds the lookups in document order and caches them in a
`WeakMap` keyed by the model. It rebuilds when the number of documents, notes
or assets changes. With a `targets` filter, `resolveNoteLink` filters the indexed
candidates instead of the whole collection. The `view` command also caps its
notice at five left-out paths, then points to `validate`.

## Verification

Model reading on the dogfood copy dropped to about 3 seconds. Validation fell
from 10 to 5 seconds on the cleaned copy and from 20 to 5 seconds on the raw
copy, with byte-identical reports from main and this change. A view prints in
3 to 4 seconds, with output identical to before. On the raw copy, the views now
print with 2,058 notes left out instead of failing.
