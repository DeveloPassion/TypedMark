# Mapped tree parents

Status: implementation of the mapped tree parent (CM-583, CM-591), 2026-10-31.

## Decision

The vault keeps each type's parent in a different field: tasks point to
projects through `related_projects`, projects to goals through
`related_goals`. On a project, `related_projects` means sibling projects. A
single parent field therefore cannot draw a goal-to-project-to-task tree. A
tree's parent may now be a `mapped_field` projection, so each type reads its
own field. Such trees are read-only: a move would have to choose which field to
write.

## Interface

`validateViews` accepts a `mapped_field` parent whose definition is a link or a
list of links (CM-583) and still reports CM-593 for a writable one, because a
mapped column is never assignable. `viewTree` reads a context row's parent
through the source mapping that matches the row's type, or the field for a plain
parent (CM-591). Result rows already carry the mapped value.

## Verification

The `tree-view-valid` vector adds a goal type and a `goal-breakdown` view, and
`tree-view-invalid` rejects a mapped text parent. A focused test draws the
goal and project as context rows above a task-only result.
