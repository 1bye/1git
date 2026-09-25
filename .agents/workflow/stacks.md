# Installed TypeScript profiles

Selected: desktop, workspace.

Use [the baseline](AGENTS.md), [React guidance](react.md) where applicable,
and [config guidance](configs/README.md).

## Apply a profile

1. Identify the runtime of each entry point and its consumers. Bun package
   management does not make a browser, Electron process, or Worker run on Bun.
2. Preserve framework-generated config. Merge shared strictness deliberately;
   the shared base sets `lib: ["ESNext"]` and `types: []`, so consumers must
   select their actual globals. Keep browser, server, tooling, and test configs
   separate where their environments differ. Check the effective configuration
   with the installed compiler's `tsc --showConfig -p <config>`.
3. Map `check`, `fix`, `check-types`, `test`, and `build` to scripts that actually
   exist. Inspect their bodies before execution. Keep fixes separate from checks;
   tests/builds can still write artifacts. Preserve any required generation step.
4. Select relevant skills below and record the chosen profile, installed versions,
   entry points, and actual check commands in the target project's instructions.
   Copying this guide alone does not install dependencies or activate skills.

TypeScript resolves relative paths against the config that declares them, and
child `files`, `include`, and `exclude` replace inherited values. Review path and
global-type changes rather than blindly stacking configs. See the
[TypeScript inheritance rules](https://www.typescriptlang.org/tsconfig/extends.html).

## Desktop

Use Electron with React in the renderer and electron-vite for the
main/preload/renderer build arrangement. Keep application code in TypeScript.

- **Boundary:** the main process owns privileged filesystem/process operations.
  Expose narrow typed operations through preload; validate IPC payloads and
  senders. Keep context isolation and sandboxing enabled and Node integration
  disabled in the renderer. Do not expose raw IPC or unrestricted Electron APIs.
  [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- **Config:** renderer code gets browser types; main/preload get the types and
  supported APIs of the chosen Electron environment. Test-runner globals belong
  in the test config. A shared IPC contract must avoid importing runtime owners.
- **Skills:** the React web skills for renderer work, plus common testing/tooling.
  Web-server and Next-specific rules do not apply to ordinary Electron screens.
- **Verify:** type check renderer, main/preload, and tests; run focused domain/IPC
  tests; build and launch Electron to exercise the changed operation. Check the
  packaged artifact when changing packaging, resource paths, or OS integration.
  Browser-only verification cannot prove the preload/main boundary works.

## Workspace layer

Apply this alongside any runtime profile when multiple real packages share code.
Use workspace dependencies and explicit public exports. Keep scripts in the
packages that own the work. Add [Turborepo](../skills/turborepo/SKILL.md) when the
project benefits from its task graph and cache; the folder layout alone is not
a reason to install it.

Describe actual task inputs, environment dependencies, and output directories.
Test cache restoration against real artifacts; do not copy `dist/**` into every
task. Register prerequisites when a consumer needs built packages. Keep persistent
development services uncached, and keep deployment/database mutations outside
routine quality-check pipelines.

## Common skills and optional dependencies

TDD (skill not installed) retains explicit invocation for a requested
regression workflow; ordinary behavior tests still follow the baseline. Select
the other skills by the relevant profile and task.

Bro (skill not installed) restates the last response in plain language.
Unslop (skill not installed) edits writing to remove filler and stock AI
phrasing while preserving meaning. Both are optional, explicitly invoked skills.

Effect, Drizzle/database drivers, Better Auth, Alchemy, and AI frameworks remain
explicit project choices. Inspect installed versions and runtime compatibility
before using their APIs. Match the installed major version and avoid dependency
upgrades during unrelated feature work.
