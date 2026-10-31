# View performance

Status: tooling follow-up to the view command (decision 044), 2026-10-31.

## Decision

On a copy of the vault's 2,238 action notes, one `view` call took 34 to 111
seconds. A profile showed that each query evaluation rebuilt the relationship
graph (about 3 seconds), that validating the saved views evaluated all of them,
and that a tree ran one full query per context row. The relationship graph is
now built once per collection model and shared by every evaluation over it, and
a tree's context rows are evaluated in one query. Results are unchanged.

## Interface

`evaluateQueryWithColumns` keeps the graph in a `WeakMap` keyed by the
collection model. Evaluation never changes the model, and a new model gets a
new graph. `presentView` collects every context path of a tree and evaluates
the view's projections on all of them with one `any` of path predicates
(CM-592).

## Verification

On the same collection, each of the five dogfood views now prints in 11 to 12
seconds, with output byte-identical to before. Validating the five views drops
from 15 to 3 seconds, and repeated evaluations from about 3 seconds to 3 to
270 milliseconds. Reading the collection model (8 to 19 seconds) is now the
largest cost. The existing tests pass unchanged.
