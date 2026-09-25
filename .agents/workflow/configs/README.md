# Shared TypeScript configs

The installed `oxlint.json` and `tsconfig.base.json` are reference templates.
Choose root tool configs, dependencies, scripts, and runtime globals in the project.

## Oxlint spacing and shadcn

The Oxlint template includes blank-line and shadcn design-system checks. Copy or
adapt its rules only where the project uses those conventions. Turn on Oxlint's
correctness rules when it replaces another linter. Keep generated files out of
the lint scope.

## Oxfmt

Install Oxfmt as a project development dependency. Keep a root `.oxfmtrc.json`
with the project's intended indentation, width, commas, and generated-file
exclusions. Use `oxfmt --check .` for a read-only check and `oxfmt .` to format.
Run the linter separately so each command has one purpose.

## TypeScript

Extend `tsconfig.base.json` only when its compiler settings fit the project.
Choose DOM, Node, Bun, or Workers types at each consumer's runtime boundary.
Run the project's existing type-check and tests after tool changes.
