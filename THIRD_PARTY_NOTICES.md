# Third-party notices

The [MIT license](LICENSE) covers 1git's original code. Dependencies and supplied
assets retain their own licenses. Preserve their notices when redistributing
source, the website, or packaged binaries.

| Component | License / retained notice |
| --- | --- |
| [GPUIX](https://github.com/remorses/gpuix), including the patched native addon | [Apache-2.0](apps/gpuix/LICENSES/GPUIX-Apache-2.0.txt); source revision is pinned in `apps/gpuix/native/config.ts` |
| [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui) | Apache-2.0; the GPUIX source pins its GPUI fork |
| [Sparkle](https://github.com/sparkle-project/Sparkle) | Upstream license is copied into the app as `Sparkle-LICENSE.txt` |
| Phosphor icons | MIT; [app notice](apps/gpuix/LICENSES/Phosphor-Icons.txt), [website notice](apps/web/public/licenses/phosphor-icons.txt) |
| Lucide and Feather repository artwork | ISC / MIT; [retained artwork notice](apps/gpuix/src/feature/repository-appearance/pattern-artwork.LICENSE) |
| Inter | SIL Open Font License 1.1; [notice](apps/web/public/licenses/inter-OFL.txt) |
| Instrument Serif | SIL Open Font License 1.1; [notice](apps/web/public/licenses/instrument-serif-OFL.txt) |
| Apple MacBook marketing artwork | Separate Apple terms; [provenance and usage references](apps/web/assets/macbook-source.json) |

The website includes screenshots and artwork supplied for 1git. Apple's artwork
is not relicensed under MIT. Check its referenced terms before reusing it in a
different product. Package manifests and lockfiles identify the other JavaScript
and Rust dependencies; their upstream license files remain authoritative.

Native modifications are kept as patches in `apps/gpuix/native/` and `patches/`.
See [upstream patch notes](docs/gpuix-upstream/README.md) for their purpose.
