# DOSBox-X / js-dos for TH01

Pinned package: emulators@8.5.2 (GPL-2.0; LICENSE included).

- Emulator source: https://github.com/js-dos/emulators/tree/6bbf0925d221a7304ea8e0dda1e89b8dc01569b2
- DOSBox-X source: https://github.com/js-dos/dosbox-x/tree/788fde99d3d451eab3621009186e5abe516f2b9c

Local JSPI binaries and glue are imported from TH03. Network resources are the
generic full Asyncify native-scheduler build, before TH03-specific battle idle
fusion. No TH03 or TH04 guest-address wait optimization is enabled. Native
scheduling and guarded CPU helpers retain the full interpreter fallback;
planar lookup is disabled. core-build.json pins source revisions and SHA-256.

TH01 keeps its patched game disk. dosbox-disk.js extracts REIIDEN files into
internal DOS, without executing the system DOS or VEM486 from the image.
The adapter provides confirmed lockstep, input, audio and direct RGB WebGL.
TH01 does not expose rollback or use the tracked core. Local play requires JSPI.

Local development import: tools/migrate_dosbox.py. Manifest refresh:
python tools/record_dosbox_runtime.py. The complete source build tools and
matching revisions are retained in the maintainer TH03 workspace; see its
DEVELOPMENT.md and tools/build_th03_core_candidate.py. They are not required
for playing this self-contained distribution.
