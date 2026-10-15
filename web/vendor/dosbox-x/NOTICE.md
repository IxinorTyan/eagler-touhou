# DOSBox-X / js-dos runtime

Pinned npm package: `emulators@8.5.2`, downloaded 2026-10-12.

- Package: https://www.npmjs.com/package/emulators/v/8.5.2
- Source: https://github.com/js-dos/emulators/tree/6bbf0925d221a7304ea8e0dda1e89b8dc01569b2
- DOSBox-X source: https://github.com/js-dos/dosbox-x
- Original DOSBox-X project: https://github.com/joncampbell123/dosbox-x
- License: GPL-2.0; the upstream license is included as `LICENSE`.

The shipped `emulators.js`, `wdosbox-x-jspi.js` and `wdosbox-x-jspi.wasm`
are copied without modification. `audio-worklet.js` is extracted verbatim
from the upstream source map. Hashes and package provenance are recorded
in `runtime.json`. The archived npm package is kept under `vendor-source/`.

The TH05 adapter and its build script are in `web/dosbox-runtime.js`,
`web/dosbox-worker.js`, `web/disk-files.js`, `web/frame-presenter.js`,
`web/frame-display.js`, `web/sidebar-background.js` and
`tools/build_fast_runtime.cjs`.
The adapter runs the PC-98 emulation in a Worker, generates complete images
through standalone OffscreenCanvas/WebGL, explicitly transfers ImageBitmap
ownership to a bounded page queue presented on page rAF (bitmaprenderer or 2D),
sends audio to the supplied upstream AudioWorklet,
and runs original patched DOS executables under DOSBox-X's internal DOS.
It does not load the VEM486 pager or the NP21 core.

For PC-98 2D, the adapter replaces the upstream pending-worker-rAF texture
presenter with `frame-presenter.js`. It immediately uploads each complete core
RGB update, reuses texture storage, and retains native game timing. The pinned
upstream JS is unchanged. Browser compositing and physical monitor scanout are
distinct from GL draw calls; no claim is made that every draw is scanned out.

The dedicated HUD strip (x=448..575 in a 640x400 frame) normalizes the darkest
current palette shade and darker components to display black in the shader.
Extra has a dark red minimum rather than pure black, otherwise visible beneath
transparent TRAM counter labels. The playfield, tile cache, core RGB data and
global game palette remain unchanged. QA compares the full expected RGB image
and records both raw/expected hashes and the number of normalized pixels.

Gameplay loads `wdosbox-x-fast.wasm`, derived from the pinned original WASM
by `tools/fix_modifier_repeat.cjs`. The only change excludes held modifiers
(Shift, Ctrl, Alt, Super) from the keyboard timer's repeated make/break calls.
This fixes periodic Shift releases that interrupt TH05's continuous rescue
gesture. Ordinary key repeat, real key press/release and the timer's memory
effects are retained. `tools/test_modifier_repeat.cjs` covers 3,208 cases.
The original WASM is retained, and both hashes are in `runtime.json`.

JSPI is WebAssembly's stack-switching API. This WASM build still interprets
x86 instructions; it does not contain a native dynamic CPU recompiler.
Unsupported browsers receive a startup error rather than a hidden NP21 fallback.
