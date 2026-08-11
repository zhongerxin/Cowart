# Third-party notices

This repository is a public fork and derivative of [zhongerxin/Cowart](https://github.com/zhongerxin/Cowart), originally published under the MIT License by Twox / ZHONG XIN. The original copyright and license are preserved in the root `LICENSE` file.

## tldraw 5.1.1

Cowart uses `tldraw` and the `@tldraw/*` packages for its canvas runtime. These packages are licensed under the tldraw license rather than MIT. The default license permits development use but prohibits production use unless an applicable trial, commercial, or alternative license has been obtained. It also requires the license text to accompany distributions.

A verbatim copy of the license shipped for the pinned `v5.1.1` source is included at [`licenses/TLDRAW-LICENSE.md`](licenses/TLDRAW-LICENSE.md). See the [official tldraw license](https://github.com/tldraw/tldraw/blob/v5.1.1/LICENSE.md) for the authoritative source.

## Excalidraw and bundled fonts

[Excalidraw](https://github.com/excalidraw/excalidraw) is used as a visual and interaction reference. Excalidraw editor code is not installed as a runtime dependency. The font synchronization tooling, bundled Excalifont files, and Xiaolai subset manifest use the official `@excalidraw/excalidraw@0.18.1` distribution as their source. Xiaolai font files load at runtime from a public CDN pinned to that package version.

- Excalidraw source code: MIT License.
- Excalifont, Xiaolai, and Assistant font files: SIL Open Font License 1.1.
- Font-specific copyrights and the complete OFL text: [`src/assets/fonts/FONT-LICENSES.md`](src/assets/fonts/FONT-LICENSES.md) and [`src/assets/fonts/OFL-1.1.txt`](src/assets/fonts/OFL-1.1.txt).

## Other runtime dependencies

[PptxGenJS](https://github.com/gitbrent/PptxGenJS) is used only through its browser build to generate standards-compliant OOXML PowerPoint files. Its package explicitly disables the Node-only `image-size` parser in browser bundles; Yogurt AI's production bundle was verified not to include that parser. PptxGenJS is distributed under the MIT License and retains its own copyright and license terms.

Other packages are installed through npm and retain their own licenses, including React, Model Context Protocol SDKs, html2canvas, Lucide, Zod, Tiptap/ProseMirror, Vite, and their transitive dependencies. Refer to each installed package's `package.json` and license file for the applicable terms.

The root MIT license does not replace any third-party license described above.
