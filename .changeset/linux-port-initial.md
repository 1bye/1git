---
"@1git/gpuix": minor
---

Add an initial Linux port: build the patched GPUIX addon on Linux, open browsers and files with xdg-open, copy with wl-copy/xclip/xsel, prompt SSH host trust and passwords with zenity, and package a self-contained Linux tarball with `bun run package:linux`. macOS behaviour is unchanged.
