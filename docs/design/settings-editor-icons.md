# Native editor icons follow-up

Settings currently uses bundled editor glyphs and a monogram for custom apps.
The existing `native/context-menu-icons-platform.patch` already validates app
bundle paths and caches `NSWorkspace iconForFile:` images, but those `NSImage`
values only reach AppKit menu items. They are not exposed as PNG data to React.

A native Settings icon implementation needs more than that lookup: a main-thread
PNG conversion/export in GPUI macOS, renderer and test-renderer NAPI methods,
TypeScript host types, and a bounded image cache/display path. Keep that work
separate from the Settings layout changes rather than extending the native
runtime solely for these small decorative glyphs.

For a future implementation, reuse the menu path validation and AppKit cache;
return a small PNG without resizing the shared LaunchServices image. Test custom
bundles, unavailable applications, cache invalidation after reinstall, and both
native app and test-renderer paths. Fall back to the bundled glyph or monogram
when reading an icon fails. No network lookup is needed.

The system default varies by file type. `ExternalEditors` currently delegates
that choice to macOS and cannot report one resolved application for all files.
