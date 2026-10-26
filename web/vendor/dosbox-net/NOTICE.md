# TH05 LAN DOSBox-X runtime

DOSBox-X and js-dos emulators@8.5.2 are distributed under GPL-2.0; see LICENSE. The TH05 local JSPI runtime remains separate. Full Asyncify preserves the complete PC-98 BIOS continuation.

The ordinary network entry uses the frozen TH05 idle-optimized native runtime (20261015): native intra-frame scheduling, guarded synchronous CPU, chunked memcmp and PC-98 planar lookup table. Both interpreter paths fuse the verified TH05 VSync loop after runtime address registration, with unchanged instruction budgets. Native RGBA presentation is disabled. CPU remains Simple, fixed 30000 cycles.

Source package: vendor-source/emulators-8.5.2.tgz. Native build lineage: th04-coop-lab/tools/patch_native_scheduler.py and build_native_scheduler.ps1; TH05 adaptation/derivation: tools/build_native_candidate.cjs and tools/build_th05_idle.mjs. The tracked binary is derived from the final TH05 untracked binary with TH04 build_dirty_core.mjs / prepare_dirty_runtime.cjs (Binaryen 132), not copied from the TH04 release. tools/build_lan_runtime.py publishes only the pinned frozen five-file set and backs up the preceding release. Hashes and enabled features are in runtime.json.

Rollback remains optional, off by default, with two adjacent predicted ticks sharing a complete checkpoint. The tracked core journals native/host writes in a 64 KiB memory; unsupported engines use the standard core and full-copy fallback. The packed page-undo helper source is tools/snapshot-diff.wat; assemble with Binaryen 132 wasm-as --enable-multimemory --enable-bulk-memory --enable-simd.
