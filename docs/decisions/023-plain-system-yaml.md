# Plain system YAML

Status: maintainer decision, 2026-10-22. Supersedes
[decision 014](014-root-yaml-preservation.md) and the drafts in TypedMark #5
and #6.

## Decision

Preserving YAML-native graphs through instantiation (sets, ordered maps,
binary and timestamp tags, unknown tags, complex keys, explicit merges and
aliases shared across the rewritten root) produced wrong output repeatedly:
#5 ended three review cycles with four failing reproductions, and #6 showed the
alias budget cannot be met by reordering for large flat alias sets. Real
systems do not need these constructs. The maintainer chose to fail closed.

The specification now requires a system's `typedmark.md` frontmatter and the
templates selected for its scaffold notes to be plain data: no anchors,
aliases or explicit tags, and only string mapping keys (SCE-159). Importers
reject violating systems instead of altering values (SCE-160).

## Interface

`plainDataViolation(node)` walks a parsed YAML node and names the first
anchor, alias, explicit tag or non-string key. System-definition validation
reports SCE-159 on `typedmark.md`; `prepareSystem` refuses non-plain templates
with SCE-160, and a non-plain `typedmark.md` already fails source validation
before anything is written. Core-schema scalars such as dates remain plain
strings, and plain vendor metadata keeps its exact scalar source text.

## Verification

The former preservation tests are now one rejection table covering each
construct from decision 014, #5 and #6, plus a positive test for plain vendor
metadata beyond native numeric precision. One golden vector reports SCE-159.

Sources: [YAML 1.2.2 node properties](https://yaml.org/spec/1.2.2/#691-node-tags)
and [eemeli/yaml visitor](https://eemeli.org/yaml/#visiting-the-document).
