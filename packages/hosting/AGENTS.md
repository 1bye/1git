# Hosting package

- Profiles: standalone TypeScript runtime library and workspace package, not UI.
- Runtime: Bun 1.3+ / Node 22+; standard fetch/streams/AbortSignal and node:crypto.
- Toolchain: TypeScript 6.0.3, Oxlint/Oxfmt, Bun tests; Emulate pinned to 0.12.0.
- Exports: client/contracts/OAuth/remote, provider extension contracts, secure transport and individual provider subpaths, compiled into `dist`.
- Provider classes extend `HostingProvider` under `src/providers/<name>/`; constructor options own host settings, credentials and OAuth registration. Keep request state out of providers and create fresh adapters per client. Never select implementations by provider ID.
- Provider options are sensitive and immutable; never serialize/log the options getter. Distinct accounts require distinct configured provider instances.
- Keep Git execution, browser opening, secure storage and app integration outside this package.
- Public fallible operations use HostingResult, matching the Git package's Result shape.
- Never log tokens, raw provider error bodies, OAuth payloads or client secrets.
- Build: `bun run --cwd packages/hosting build`.
- Types (includes examples/consumer imports): `bun run --cwd packages/hosting check-types`.
- Default offline checks: `bun run --cwd packages/hosting test` after build.
- Local HTTP/Emulate checks: `bun run --cwd packages/hosting test:integration` after build; requires local port binding, never real accounts.
- Lint/format: `bun x oxlint packages/hosting` and `bun x oxfmt --check packages/hosting`.
- Turbo registers this package's build as a prerequisite for types and tests; integration is uncached.
