# Edits and renames

Status: implementation of specification #72, 2026-10-28.

## Decision

Tools stay replaceable only if writing through one does not reformat what
another wrote, and renames do not break links. TypedMark adds the optional
Edits and Renames writer contract, and the reference tooling now claims it:
edits keep untouched frontmatter text, new keys follow declared order, renames
and moves rewrite every link that reached the note, and an edit that changes a
value the storage rules read re-files the note and the notes stored through it.
Re-typing still refuses renames that need link rewriting; it can move to this
planner later.

## Interface

`editFrontmatter(text, changes, order)` assigns or removes top-level keys
line by line: other entries, their comment lines, blank lines, delimiters, line
endings, any BOM and the body keep their bytes, and a single-line value keeps
its trailing comment. `planEdit(root, schemas, { path, set, renameTo })`
returns moves (re-filed to a fixed point through linked storage placeholders),
link rewrites in frontmatter values and body spans (form, label, anchor, embed
and path style kept; names become root-relative paths when ambiguous), and the
files to write, or unresolved issues and no files. `applyEdit` stages every
file before renaming it into place and prunes emptied folders. The CLI gains
`edit` and `rename`, dry runs unless `--write`.

## Verification

Four focused tests cover edit fidelity with comments, quoting, block scalars,
CRLF and a BOM; key removal; a title edit re-filing a project and its decision
log while rewriting name, embed, anchored, Markdown and frontmatter links,
keeping a now-ambiguous link on its target, then validating clean; and a taken
target that writes nothing. No golden vectors: writer behavior is outside
validation reports.

Sources: [Edits and Renames](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/edits-and-renames.md).
