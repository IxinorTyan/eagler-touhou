# TH05 Chinese Translation

The supplied `uth05win/chs.dat` is the sole translation source. SHA-256:
`576f297a7240ebc13174863a0d7aee35e0d0d13a834bb1d0b62f7e8e39a0cd0e`.

`tools/build_translation.py` converts all nine TX2 files, twelve endings,
seven stage title/BGM triples, two stage-four survivor BGM names, native score
summary strings, and 21 applicable title-menu descriptions. Both regular disk
builders apply the same conversion after verifying the frozen executable.
Original baseline disks remain immutable.

The Windows-only replay menu is absent from the original PC-98 menu. Windows
implementation notes in menu descriptions are omitted; the exit target is DOS.
The Windows-only Extra score multiplier has no native table slot. Music-room
and staff-roll text have no supplied translation; they remain original.

`mapping.json` maps Unicode to native two-byte Shift-JIS-shaped codes. The
custom slots avoid the two CG RAM rows used by ZUN's gaiji. `CNFONT.BMP.gz`
contains a bitmap based on the supplied `anex86.bmp`, with the 748 translation
glyphs replaced from GNU Unifont 15.1.05. The exact Unifont subset is retained
in `unifont-subset.hex`, under the SIL OFL license in `OFL-Unifont.txt`.
The two runtimes load this font from the verified disk before PC-98 startup.
No per-frame browser translation or font replacement is performed.

Normal rebuilds need only these frozen resources. To regenerate the frozen
font/source snapshot, use `python tools/build_translation.py` with the supplied
uth05win folder and `build/unifont-15.1.05.hex.gz` available. The font download:
https://unifoundry.com/pub/unifont/unifont-15.1.05/font-builds/unifont-15.1.05.hex.gz

Validation: `python tools/test_translation.py`,
`node tools/test_translation_browser.cjs`, and the existing native/room tests.
New disk hashes invalidate playback against older disk identities by design.

## Layout verification (2026-10-22)

Dialogue uses the original PC-98 positions and 16-pixel glyph advance. All 500
boxes (all four character streams in nine files) fit the native 18-cell,
three-line area. The twelve ending scripts are also interpreted by the audit
using the native 480-by-64 text area, explicit line/page commands and 64-pixel
continuation indent. Five automatic line continuations fit without triggering
the native implicit-page overwrite bug.

Real-core screenshots cover title descriptions, the first stage opening and
sample pages of Reimu's bad, good and Extra endings, at desktop and mobile
sizes. A previous accelerated stage-four capture stopped the background scroll
at a nonzero origin; its shifted boxes were a test artifact, so those images
are not valid layout evidence. The Japanese and Chinese runs were recaptured
with the stage graphics at the same zero scroll origin, showing the upper and
lower boxes and their text at the original positions. The translation audit
also compares all 36 character streams against the Japanese disk and verifies
that every text box keeps its original side, portrait, wipe and cursor commands.
No production coordinates were changed. These paired samples do not constitute
a full visual review of every route, character or page.

Native dialogue origins are `(48,192)` for the boss and `(160,320)` for the
player, with a 16-pixel line advance, 288-pixel text width and three lines.
These are full 640-by-400 screen coordinates, not browser canvas coordinates.
`reports/translation-jp-cn-layout-comparison.png` pairs the corrected stage-four
captures. `translation-{jp,cn}-layout-final.json` records the zero hardware
scroll origin used by the private accelerated fixture and the continued-battle
and HUD checks. `translation-cn-yuki-layout-final.json` covers the other
survivor branch with Mima and Yuuka.
`node tools/test_translation_layout_reference.cjs` captures the original solo
first-stage dialogue through its native stage flow; it never forces the scroll
switch. Allow up to ten minutes per language (or set `PROBE_POLLS`, in 100-ms
polls). The report records captures for visual review, not automated approval.
The 2026-10-22 solo comparison reached first-stage dialogue naturally at tick
8639 with scroll zero in both languages. The inspected player and boss samples
(`layout-native-{jp,cn}-0.png` and `layout-native-{jp,cn}-3.png`) use the same
original text origins. This test only refreshes the player's invulnerability
timer; it does not alter the dialogue engine, stage scroll or production disk.
`tools/build_translation_fixture.py` creates private ending-entry MAIN
executables under `build/`; the browser test injects these only into its own
worker. Production disks keep their ordinary gameplay and original MAINE.
Use `node tools/test_translation_browser.cjs --ending` to capture those pages.
Screenshots require human review; a successful capture is not a complete
visual approval of every character route or every page.

The current browser Replay regression test reaches a final-memory mismatch
on playback. The same test also fails with the unchanged Japanese disk.
Do not count Replay as passed for this translation build until
that failure is resolved; the disk/resource and native/co-op checks are
separate evidence.
