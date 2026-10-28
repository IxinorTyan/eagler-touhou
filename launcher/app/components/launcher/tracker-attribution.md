# Touhou 1CC chart

The chart layout, game definitions, Canvas drawing routines and pixel fonts are adapted from [Doopu / 1ccTracker](https://github.com/doopu/1ccTracker), fetched on 2026-10-28 (index.js Git blob `70b56e980e8893cc5f5d7258e64f2dbf3cae45fd`). The original site credits an earlier community chart whose author is unknown and credits Doopu for recreating its fonts.

`tracker-renderer.ts` retains the original chart drawing and all 32 game blocks. The browser-global initialization, DOM controls and storage have been replaced by isolated renderers and the React career viewer. Each instance receives records and display options; it does not read or write browser storage.

The locally bundled fonts live in `app/assets/1cc-tracker/`. `tracker-records.ts` owns chart cells and validation. The frontend demo saves under `player-career-chart-v2`. Views, editors, backup import/export and gestures are implemented in `CareerShowcase.tsx`.
