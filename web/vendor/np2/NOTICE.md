# Upstream components

NP2-wasm by irori, based on Neko Project II.

- Source: https://github.com/irori/np2-wasm
- Prebuilt distribution: https://irori.github.io/np2-wasm/
- Downloaded: 2026-10-03
- License: BSD-3-Clause; see LICENSE in this directory.
- Local copies: np2-wasm.js, np21.js, np21.wasm, font.bmp.
- The launcher uses NP21 (i386) for compatibility with the disk's VEM486 driver.
- font_cn.bmp is copied from the user's existing local game bundle, not from upstream.

The local wrapper removes the unused NP2 factory and passes the buffered solo
audio option to NP21. The launcher uses `np21-60.js`, copied from the local
`th04-coop-lab` project on 2026-10-09, together with `np21-mobile.wasm` and
`web/frame-limit.js`. That adapter caches static WASM table entries, caps host
presentation at 60 Hz, and optionally buffers native solo audio. The optimized
WASM uses native exception handling on supported browsers; other browsers use
the retained original `np21.wasm`. The emulator's native elapsed-time clock is
unchanged. The TH01 launcher configures a clock multiplier of 16.

The TH01 adapter adds an optional `shouldPresentFrame` callback immediately
before optimized RGB565, SDL Canvas and WebGL output. The native game marks unfinished rendering; the
callback retains the previous complete canvas during that interval. Simulation
and audio continue. `tools/patch_presentation.py` reproduces this scoped change
from the TH04 copy; TH04 files and the WASM binary are unchanged.

The optimized RGB565 path also exposes an optional `inspectPresented565`
callback for the localhost QA. It inspects the source buffer before upload;
normal gameplay does not install it. No emulation or output pixels are changed.

`frame-runtime.json` preserves the generating project's metadata. Its source
hash identifies the TH04 generator input, not the local `np21.js` file.
`SHA256SUMS.json` records hashes of the actual shipped files and provenance.
The original `np21.js` and `np21.wasm` remain available for maintenance.

The network entry uses the sibling TH04 deterministic-clock adapter and
`np21-rollback.wasm` / `np21-rollback-mobile.wasm`, copied on 2026-10-11.
Its fixed host clock, native audio scheduling, ICE diagnostics and relay
are adapted by `tools/build_netplay_runtime.py`; source and output SHA-256
values are pinned in `web/netplay/vendor-provenance.json`.
The TH01 adapter adds the completed-frame gate at the SDL Canvas upload.
The initial TH01 protocol runs confirmed lockstep without invoking snapshots
or prediction; the inherited snapshot capability is reserved for future work.
Solo assets remain pinned to their earlier TH04 snapshot, independently of
changes to the current sibling project. Both entries retain this license.
