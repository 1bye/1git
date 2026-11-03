# Syntax renderer attribution

The language detection and scope mapping in `src/diff_viewer/syntax/scopes.rs`
are adapted from GPUIX native syntax at revision
`9fcd628863e354e9c58019fc3bf38981a1e64158` (Apache-2.0, Copyright 2026 remorses),
which credits Comet's `crates/syntax/src/lib.rs` (MIT, Copyright 2026 Wing).
This port removes the unused document/cache API and uses prepared per-diff-side spans.

- [GPUIX Apache-2.0 license](licenses/gpuix-APACHE-2.0.txt)
- [Comet MIT license](licenses/comet-MIT.txt)

Syntect 5.3 and two-face 0.5.2 supply the same parser and syntax pack as the
reference app. Their source licenses ship with the crates. Licenses requiring
acknowledgement for the embedded syntax definitions are reproduced in
[syntax definitions](licenses/syntax-definitions.md). Include these notices
when distributing the native application.
