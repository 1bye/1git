# Native test-session retention and shutdown

Suggested PR title: **Fix native test renderer teardown and macOS view retention**.

## Problem and cause

Repeatedly constructing `TestGpuixRenderer` retained old AppKit windows/views and
Metal pipelines, even without React, Git operations, or image previews. Forced
JavaScript GC did not resolve it.

There were several interacting lifetimes:

- `VisualTestPlatform` delegated native window creation to `MacPlatform`, whose
  foreground executor was not the deterministic test executor. Draining the test
  scheduler did not execute the deferred native close task.
- `MacWindowState` owned an AccessKit adapter that retained the window's content
  view. Its GPUIView child retained the Rust window state through an ivar,
  forming an ownership cycle.
- Native test calls ran outside the normal AppKit autorelease/event-loop scope.
- Leaving the final session to Rust TLS destruction exposed a profiler TLS
  access panic at process exit once teardown started actually releasing windows.

## Implemented changes

Sources: [addon patch](../../apps/gpuix/native/test-session.patch) and
[platform patch](../../apps/gpuix/native/test-session-platform.patch).

In GPUIX `packages/native/src/test_renderer.rs`:

- Dispose the previous singleton session before creating its replacement.
- Remove the window and run cleanup while its GPUI app and entities still exist.
- Scope macOS autoreleases around construction, native test calls, and teardown.
- Expose an idempotent static `TestGpuixRenderer.disposeCurrent()`.
- Register N-API environment cleanup before Rust thread-local destruction.

In the GPUI fork:

- Route native test-window work through the test foreground executor.
- Keep off-screen test windows unordered (`show: false`).
- Drain pending macOS run-loop work within native teardown.
- Drop the accessibility adapter before releasing the native window, breaking
  the content-view cycle; scope deferred close work with an autorelease pool.

The adapter-cycle fix affects normal macOS window teardown too. Executor
overrides, test pools/helpers, and hidden-window behavior belong to test support;
visible application windows keep asynchronous close behavior.

## Reproduction and regression

The minimal reproduction repeatedly constructs an 800×600 native test renderer,
applies an empty div/root batch, and flushes. Inspect live allocations before
process exit. This isolates native lifecycle from application code.

Checked-in regression:

- [Native child probe](../../apps/gpuix/tests/_shared/test-session-native.ts)
- [Lifecycle integration tests](../../apps/gpuix/tests/native-session/lifecycle.integration.test.ts)

The child creates 60 renderers, disposes midway twice, creates more, then disposes
again twice. The parent uses macOS `heap -s --noContent` to assert that no GPUI
windows/views remain. There is no JS GC or caller-side event pumping. A second
case leaves the last session alive and verifies automatic host-exit cleanup.

From `apps/gpuix`, with the patched native addon built:

```sh
bun test tests/native-session/lifecycle.integration.test.ts
bun test tests/close-protection/native.integration.test.ts
bun run test
bun test --preload ./native/preload.ts --rerun-each=20 tests/repository-diff/viewer.component.test.tsx tests/workspace-tabs/workspace-tabs.component.test.tsx tests/repository-diff/image-preview.unit.test.ts
```

These native checks require macOS graphics/debugging access. Port the scenario
to upstream rather than copying 1git's test imports.

## Observed evidence, 2026-09-28

| Measurement | Before | After |
| --- | --- | --- |
| Live GPUI views after 200 replacements, current renderer still alive | 200 | 1 |
| Live Metal render pipelines in that diagnostic | 1,600 | 8 |
| Explicit disposal regression | Not available in original API | Zero remaining GPUI windows/views |
| Last sampled process memory in 1,000-check stress workload | About 1.6 GB | About 206 MB |

The stress workload passed 1,000 checks. The complete GPUIX unit/component suite
passed 245 tests; lifecycle and close/quit integration checks passed as well.
Build, types, lint, and formatting were checked; repository lint reported existing
desktop warnings. Final builds used GPUI's runtime-shader feature because the
offline Metal compiler was unavailable.

The allocation counts and process-memory samples are different measurements.
They are local observations, not a controlled cross-platform benchmark or a claim
that everyday application memory drops by the same amount. Raw diagnostic logs
were temporary; the checked-in reproduction is the durable evidence to rerun.

## Upstream review points

- The current run-loop drain has a bounded **5 ms** budget. Review reentrancy,
  scheduling guarantees, and slower-machine behavior rather than treating the
  duration as a universal guarantee.
- `show: false` changes visual-test behavior beyond macOS in the current patch.
  Windows/Linux rendering and screenshot behavior still need verification.
- Validate N-API cleanup ordering under Node.js and multiple environments on one
  thread; current cleanup registration and test state are thread-local singletons.
- Generate and document the new static JS method upstream. The local regression
  accesses it reflectively because published 0.10.0 declarations lack it.
- Consider separate PRs for the GPUI accessibility ownership fix and the
  dependent GPUIX test-session lifecycle work.
- Do not switch ordinary window destruction to immediate synchronous close: an
  experimental version panicked when callbacks accessed an already-released app.
