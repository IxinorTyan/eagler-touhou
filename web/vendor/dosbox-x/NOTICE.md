# DOSBox-X / js-dos runtime for TH04

Pinned npm package: `emulators@8.5.2`, obtained 2026-10-12.

- Package: https://www.npmjs.com/package/emulators/v/8.5.2
- Emulator source: https://github.com/js-dos/emulators/tree/6bbf0925d221a7304ea8e0dda1e89b8dc01569b2
- DOSBox-X source: https://github.com/js-dos/dosbox-x
- Original project: https://github.com/joncampbell123/dosbox-x
- GPL-2.0 license: included in `LICENSE`.

The original npm archive is retained in `vendor-source/emulators-8.5.2.tgz`.
Pinned glue, binaries, package metadata and extracted upstream worklet are in
`vendor-source/emulators-8.5.2/`. Distribution hashes are in `runtime.json`.

`emulators.js`, `wdosbox-x-jspi.wasm` and `audio-worklet.js` are unchanged upstream
assets (the worklet was extracted verbatim from the upstream source map).
`dosbox-jspi.mjs` adjusts the worker dispatcher and exports the JSPI factory.
`wdosbox-x-fast.wasm` excludes held modifier keys from artificial timer repeat;
the exact audited binary transformation is `tools/fix_modifier_repeat.cjs`.

The TH04 adapter is `web/dosbox-adapter.js`, `web/dosbox-disk.js` and
`web/dosbox-snapshots.js`. It runs the existing patched TH04 executables and
GAME.BAT with the PMD driver under DOSBox-X internal DOS. It does not execute
the NP21 core or VEM486 pager.

Local execution uses JSPI with Simple CPU and automatic cycles. Network
execution uses deterministic virtual time and Asyncify of the same proven
JSPI WASM, including CPU and nested BIOS call paths. `tools/build_asyncify.ps1`
uses Binaryen 132; `tools/build_full_rollback.cjs` adds continuation access and
exports mutable native globals. Complete RAM, execution state and filesystem
undo are captured by the adapter. Network correctness requires restore/replay
and multi-client verification; merely shipping this build is not validation.

`tools/build_dosbox_runtime.cjs` builds both glue modules and version manifests
from this project's pinned sources. It does not read a sibling project.

The x86 CPU is interpreted. This build does not include a dynamic x86 compiler.
Unsupported local browsers receive a startup error. There is no NP21 fallback.
