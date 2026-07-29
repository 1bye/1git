# 1git

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Biome** - Linting and formatting
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
- `bun run check`: Run Biome formatting and linting

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
