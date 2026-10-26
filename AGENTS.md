# 1git Code Standards

Use Oxlint for linting and Oxfmt for formatting. Read the installed workflow guides below for TypeScript, React, desktop, and workspace work.

## Quick Reference

- **Check code**: `bun run check`
- **Fix lint and formatting**: `bun run fix`
- **Check types**: `bun run check-types`

## Active runtimes

- `apps/gpuix` is the native macOS app: Bun, React 19, and GPUIX 0.10.0.
  Start it with `bun run dev:app`; Turbo builds workspace dependencies and the
  patched native addon. There is no browser renderer or Electron IPC layer.
- `apps/web` is the Astro website; its own `AGENTS.md` covers browser and Worker boundaries.
- `apps/releases` owns Cloudflare download/update infrastructure. Deployment and
  publishing are explicit maintainer operations, separate from ordinary checks.
- `bun run test:portable` runs suites without native graphics. `bun run test`
  additionally requires a built native addon and macOS graphics access.
- The desktop profile in `.agents/workflow/stacks.md` is a generic template;
  the actual native runtime above takes precedence for this repository.

## Changesets and releases

- For each releasable bug fix, feature, performance improvement, or breaking
  change, add a focused `.changeset/*.md` file with the code change. If this task
  already has a pending changeset, update it instead of adding a duplicate.
- Use `patch` for fixes, `minor` for features, and `major` for breaking changes.
  Select package names from their manifests. Include `@1git/gpuix` whenever a
  change needs a desktop release, including fixes in its internal dependencies;
  also include the internal packages changed by the task.
- Use the noninteractive CLI from the repository root, for example:
  `bun run changeset --patch @1git/gpuix,@1git/git --message "Fix repository loading after reconnecting."`
  Use `--minor` or `--major` as appropriate; comma-separated package names share
  a bump type. Write a concise user-facing summary of the problem and result.
- Documentation-only, test-only, and tooling changes, or refactors with no
  released behavior change, can omit a changeset. Do not add empty changesets
  just to satisfy status. Preserve unrelated pending changesets.
- Run `bun run changeset:status --verbose` after adding or updating a note and
  check its packages and bump types. In the final response, name the changeset
  file or briefly explain why this task does not need one.
- During ordinary development, leave package versions and `CHANGELOG.md` files
  for release preparation. Run `bun run changeset:version` only when preparing
  a release requested by the user; it consumes all pending changesets.
- For release work, follow [the release guide](docs/RELEASING.md), including the
  first app-version alignment with the published feed. Preparing versions and a
  dry run does not itself authorize binary publication, deployment, or pushing
  tags. Perform those operations when the user's release request includes them.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## Manual Review

Review business logic, naming, architecture, edge cases, accessibility, and documentation beyond automated checks.

<!-- workflow:begin -->
## TypeScript workflow

For TypeScript work, read `.agents/workflow/AGENTS.md`.
For runtime and stack work, read `.agents/workflow/stacks.md`.
Preserve this project's specific instructions and existing tooling.
<!-- workflow:end -->
