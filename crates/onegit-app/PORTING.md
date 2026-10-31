# Native app appearance port

The GPUIX implementation in `apps/gpuix` is the reference. Its welcome/sidebar,
workspace tabs, change list, composer, last-commit footer, revision panes, commit
subjects and native diff renderer map to `workspace/home`, `chrome`, `view`,
`history`, and the shared `onegit-ui` controls. Exact SVG glyphs and the original
grain are embedded; macOS material uses the same public AppKit Sidebar settings.
Rake 011294cb leaves custom chrome transparent so that material remains visible.

Local library data is imported read-only on first launch, then saved separately.
Only names are imported for remote machines; credentials and connections are not.
Repository reads stay off the UI thread; visible Home status reads are bounded.
Git paths and staging/commit semantics remain those of the existing Rust app.

## Verification

Compare equal-size 1280×820 native windows: Home with the same GitHub folder;
Changes with `onbot` / `docs/guides/models.md`; History with `pkgs`, commit
`15e69589e0298f2a1018b6d93d1f9d6730d5a7d8`, and `bun.lock`. Keep appearance,
scroll positions and selected files equal. Native capture may fail transiently;
a successful build or accessibility snapshot alone does not establish visual parity.
The October 30 comparison used successful full-window native captures of light and
dark Home, the same unstaged `models.md` patch, and the same immutable `bun.lock`
commit. It corrected Sidebar material, tab/avatar placement, compact typography,
checkbox alignment, diff gutters, hunk heights, changed-word backgrounds and the
revision/file split and read-only outgoing markers. Native automation also caught
a multiple-active-descendant panic when focus returned to the shared workspace;
lists and menus now report an active descendant only while they own focus. A fresh settled Home capture showed a four-column grid;
tiles now measure the real library width, reflow between columns on resize and
virtualize complete rows. The supplied single-column Home capture represents its
initial measurement state. The live `pkgs` checkout changed branches during verification;
comparison of commit details stayed anchored to the immutable SHA above.

Geometry/event tests pin Home dimensions, workspace chrome, file rows, composer,
hunk/line heights, proportional resizing, focus, retained navigation and real Git
operations. Run the app/UI and gallery tests, Clippy, rustfmt, rustdoc and workspace
spacing checks described in `docs/RUST.md`.

## Intentional differences

Rust retains index staging rather than the source app's selected-file inclusion
workflow. It retains a single mounted repository and explicit page loading in
History. Unported workspace network, branch-switching, AI, amend/undo, stash,
graph, account and SSH actions are unavailable. Read-only diffs do not include
hunk staging, context expansion, syntax highlighting or text selection.
These are behavior gaps, not a claim that the full original application is ported.
Only persisted source library/cache entries are imported; unsaved source runtime
state can differ. Repository contents, refs and the source session are not written
by import or preview operations.
