# TypeScript testing defaults

Use alongside [the TypeScript baseline](AGENTS.md). Keep the project's existing
runner and established layout. For a new test structure, use the conventions
below. Apply them to tests being added or substantially changed; do not reorganize
unrelated suites during a focused fix.

## Ownership and files

- Keep tests in the owning app or package's root `tests/` directory, outside
  `src/`, grouped by feature: `tests/<feature>/<behavior>.<category>.test.ts`.
  Use `.test.tsx` when the test needs JSX.
- Keep one coherent behavior and one category per file. Several related scenarios
  can share a file. Split when responsibilities or setup differ, not by line
  count. Do not repeat the category in directory names or create empty suites.
- Put reusable helpers, mocks, schemas, fixtures, and setup/cleanup in the owner's
  `tests/_shared/`. Keep one-off setup local. Use descriptive filenames and direct
  imports; avoid helper barrels and imports from another package's test internals.
- Factories create fresh mutable state on each call. Avoid shared module-level
  capture buffers. Keep scenario inputs, execution, and assertions in the test
  body; helpers capture results for the test to assert on.

## Categories and real dependencies

Choose the category by what the test proves. Mock usage alone does not determine
the category.

| Category | What it proves | Dependency boundary |
| --- | --- | --- |
| `unit` | Isolated logic, schemas, or configuration | Explicit inputs or doubles; no live external service |
| `component` | Cooperating code in-process | External I/O replaced or captured; no live external service |
| `integration` | A specific real external boundary | The dependency being claimed is real; name unrelated doubles |
| `e2e` | A user journey through running applications | Real browser, native, or CLI flow as applicable; name third-party doubles |

A captured HTTP request can prove serialization but cannot prove that the remote
service accepts it. An in-memory router test does not verify a deployed runtime.
State the actual boundary instead of overstating coverage.

Integration tests use explicit test configuration and isolated resources. Never
infer test credentials from application credentials or use production resources.
An explicitly requested suite must fail clearly when required configuration or
services are missing; do not silently skip or substitute mocks. Clean up resources
and temporary environment changes even when a test fails.

## File summaries and scenario comments

Begin each new or substantially changed test file, before imports, with a short
summary using `Covers:`, `Real:`, `Doubles:`, and `Requires:`. Use `none` where
appropriate. Describe coverage areas and dependency boundaries without repeating
every test title or maintaining test counts.

```ts
/**
 * Covers: valid requests and rejected input at the HTTP boundary.
 * Real: request schemas, in-memory router, and service implementation.
 * Doubles: repository with fresh in-memory data for each test.
 * Requires: none.
 */
```

Helpers are not test files and do not need this summary. Integration summaries
must identify their real dependency and required test configuration.

- Name tests after observable behavior. Add a short Given/When/Then or regression
  explanation only when setup, ordering, or intent is non-obvious.
- Separate arrangement, execution, and assertions with blank lines. Keep closely
  related setup together and assertions inside `test()` or `it()` blocks.
- Use optional inline flows for multi-step scenarios. Put a larger diagram shared
  by several scenarios in the feature's documentation. Do not add a diagram or
  custom scenario wrapper when the code and test name already explain the case.
- Keep suites reasonably flat, use async/await instead of done callbacks, and
  do not commit `.only` or `.skip`.

## Suite execution

- Keep default `test` execution offline, covering unit and component tests. Run
  integration and e2e suites separately with their declared prerequisites.
- Define category scripts only in packages that contain that category. Package
  scripts own execution; workspace scripts delegate through the existing runner.
  Do not introduce a workspace tool solely to apply this guide.
- Keep integration and e2e tasks uncached. Do not hide absent expected suites
  with a pass-with-no-tests option.
- Run relevant suites and the project's actual type, lint, and build checks.
  Exercise a real boundary when changing its behavior or integration tests.
  Report unavailable prerequisites and verification limits explicitly.
- Review test placement, summaries, dependency claims, and useful comments.
  These conventions do not require a custom discovery framework or header linter.
