# Roadmap

What's shipped, what's next, and what we're exploring. Ideas and votes are
welcome in [GitHub Issues](https://github.com/1bye/1git/issues).

## ✅ Shipped

- Native macOS app with text and image diffs, staging, and commits
- History, branches, tags, stashes, and commit graph
- Tabs, spaces, and worktrees
- Repositories on remote macOS and Linux machines over SSH
- GitHub and GitLab accounts with pull and merge requests
- AI commit messages (OpenCode, ChatGPT, Claude Code, Codex, custom APIs)
- Sync and conflict review
- Themes, repository colors, icons, and artwork
- Automatic updates
- Developer ID signing and notarization
- Customizable noise patterns for the app's appearance
- Larger AI selections for CLI providers (beyond 64 KiB)
- Resizable left columns for repository navigation and file lists
- Settings redesign, onboarding improvements, and broader UX polish

## 🚧 Next

- Issues and pull requests: browse, create, and review them in the app
- [ACP](https://agentclientprotocol.com) support for AI agents

## 🔭 Later

- Port to Rust [GPUI](https://www.gpui.rs) (likely with gpui-fast, gpui-motion, and rake)
- Rust port: configurable background Git fetch to refresh remote branches and
  ahead/behind counts, including an optional lightweight Rust helper for updates
  while minimized or after the main app quits, with minimal idle resource use and
  no automatic pulling or merging
- Multiple platforms: Intel and Universal macOS builds, Linux, and Windows
- More Git hosting providers (Forge, Trylle, Git Cafe etc.)
- Interactive rebase: reorder, squash, and edit commits visually
- Blame and per-file history
- AI review: explain a diff or flag risky changes before committing
- Better conflict resolution
- Command palette for every action
- Three-way merge conflict editor
- Git LFS and submodule support
- CI status on branches and pull requests
- Localization
