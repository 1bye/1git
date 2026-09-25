# Shared TypeScript configs

New workflow installs copy the combined Oxlint config into root `.oxlintrc.json`
by default. Copies under `.agents/workflow/configs/` are reference templates.
Existing installs retain their recorded choice; `--oxlint` enables root config
installation and `--no-oxlint` leaves an existing project-owned config alone.

## Oxlint spacing and shadcn

Enable `@stylistic/padding-line-between-statements` in the active config to separate
declaration groups, control-flow statements, and returns/throws after other work.
Consecutive short declarations stay together. `no-multiple-empty-lines` limits
consecutive gaps to one; `padded-blocks` keeps block edges compact. These two cleanup
rules alone do not add spacing. Semantic grouping still requires judgment.

Install the default config's dependencies in the consuming project:

```sh
bun add --dev --exact oxlint@1.85.0 @stylistic/eslint-plugin@5.10.0 @shadcn/lint@0.2.0
```

The installer copies configs but does not install dependencies or edit package
scripts. Use `"lint": "oxlint ."` and `"lint:fix": "oxlint . --fix"`. Merge spacing
rules into an existing project-owned config instead of replacing it. The combined
template also includes shadcn checks; adapt those to the project's design system.
Turn on correctness rules when Oxlint replaces another linter. Exclude generated
files from linting.

## Oxfmt

Install Oxfmt as a project development dependency. Keep a root `.oxfmtrc.json`
with the project's intended indentation, width, commas, and generated-file
exclusions. Use `oxfmt --check .` for a read-only check and `oxfmt .` to format.
Run the formatter before lint fixes, then check both so newly wrapped statements
receive their required gaps. Formatting alone does not create logical groups.

## TypeScript

Extend `tsconfig.base.json` only when its compiler settings fit the project.
Choose DOM, Node, Bun, or Workers types at each consumer's runtime boundary.
Run the project's existing type-check and tests after tool changes.
