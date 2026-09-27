# 1git

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Oxlint and Oxfmt** - Linting and formatting
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

Then, run the development server:

```bash
bun run dev
```

## Disposable Git playground

Run `bun run playground` to create a fresh set of example repositories in a
temporary folder. No personal repository, GitHub account, or network is needed.
Open the printed `02-compare` path in the desktop app to try branch comparison.
The generated `START-HERE.md` includes a checklist for changes, previews, commits,
history, stashes, worktrees, local fetch/pull/push and merge-conflict recovery.

Every run creates a new folder and preserves older playgrounds. Once finished,
close their app tabs and move the generated folder to Trash. Do not keep real work
there: the operating system may clean temporary storage.

Generator verification: `bun test packages/git/tests/playground.integration.test.ts`.

## Git Hooks and Formatting

- Run checks: `bun run check`

## Project Structure

```
1git/
├── apps/
│   └── desktop/        # Electron + Vite + React desktop app
└── packages/
    ├── config/         # Shared TypeScript configuration
    ├── git/            # Structured repository-control API
    └── ui/             # Tailwind theme and shadcn components
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run check-types`: Check TypeScript types across all apps
- `bun run test`: Test all packages
- `bun run check`: Run Oxlint and check Oxfmt formatting
- `bun run fix`: Fix lint issues and format files

Run only the desktop app and build its workspace dependencies with:

```bash
bun run dev --filter=@1git/desktop
```

## Renderer Git API

The sandboxed renderer uses the typed preload API at `window.desktop.git`.
Long-running calls use operation IDs instead of sending `AbortSignal` through
Electron IPC:

```ts
const operationId = window.desktop.git.operations.createId();
const fetchResult = window.desktop.git.sync.fetch(
  sessionId,
  { remote: "origin" },
  { operationId }
);

await window.desktop.git.operations.cancel(operationId);
await fetchResult;
```

Repository selection uses Electron's native directory dialog in the main
process:

```ts
const selection = await window.desktop.git.sessions.pickDirectory();
if (selection.status === "selected") {
	await window.desktop.git.sessions.open({ path: selection.path });
}
```

Recent repositories are stored in
`app.getPath("userData")/recent-repositories.json`. The versioned file contains
only canonical local paths and last-opened timestamps. Missing or moved paths
are pruned and can be reopened from their new location.

Git authentication remains owned by Git credential helpers and SSH agents.
HTTP remote URLs containing embedded usernames, tokens, or passwords are
rejected; the desktop persistence file never stores remotes or credentials.

Repository views can use `useRepositoryRefresh` to debounce refresh work after
Git mutations and when the desktop window regains focus:

```tsx
useRepositoryRefresh(sessionId, () => {
	void refreshSnapshotAndHistory();
});
```

The callback is scoped to the requested session and receives the structured
mutation or window-focus event. Continuous filesystem watching is intentionally
deferred; focus refreshes reconcile changes made while the app was inactive.
