# Native editor icons

External editor choices display 64×64 transparent PNGs from macOS
`NSWorkspace iconForFile:`, at 28 points. The AppKit bridge runs on the main thread
and draws into a separate bitmap without resizing LaunchServices' shared image.
It validates local `.app` paths and never launches an application or writes an
image to disk. Both production and test renderers expose the same bridge.

The React component requests icons after mounting. A bounded cache holds at most
64 images per renderer, keyed by application path and bundle metadata revision.
Refreshing editor discovery rereads the bundle and Info.plist metadata so replacing
or reinstalling an application invalidates its cached image. Missing applications,
failed lookups and unavailable native support use the bundled glyph or monogram.

The system default varies by file type. `ExternalEditors` delegates that choice
to macOS, so its row keeps the generic editor glyph instead of implying one app
is the default for every file.

Native coverage checks installed and custom applications, PNG bounds and alpha,
invalid paths, replacement at the same path, image rendering in both themes and
fallbacks. The custom fixture generates its own `.icns` artwork with `iconutil`;
its executable is never run.
