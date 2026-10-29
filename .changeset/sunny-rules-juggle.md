---
"@1git/gpuix": patch
"@1git/git": patch
---

- Target exact filenames when resolving conflicts, staging, unstaging, restoring, or stashing selected files.
- Delete only the reviewed stash during concurrent Git updates, including branch backup cleanup. Safely refuse deletion for unsupported reference formats.
- Prevent background SSH requests from racing machine settings, removal, or disconnection.
- Update the source branch when refreshing a pull-request preview after switching branches.
- Avoid collisions with configured Codex MCP servers when reading large selections.
