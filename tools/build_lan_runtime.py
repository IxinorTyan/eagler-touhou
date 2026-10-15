"""Publish the frozen TH05 idle-optimized native runtime, retaining the prior release."""
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1]
source = root / 'build/native-scheduler/runtime-th05-idle-20261015'
target = root / 'web/vendor/dosbox-net'
expected = {'dosbox-rollback.mjs': 'b86ffabafe90b43c0e12745ebd2d03e0da3353a53f765ad50a2008d12e291e8e', 'dosbox-rollback-tracked.mjs': 'f7224bcb7e5ea881525760f3b71b194d01e127acf31103a5400a06d9d004d048', 'wdosbox-x-rollback.wasm': '8252d54ad9bc8cd14b0ae17055bc13e248de82d6f67f21e2064f9be452a24f49', 'wdosbox-x-rollback-tracked.wasm': '77d5f2c80a70c3399d48371066d2b34ca2b4b85e5cf28af9390b5a6825fae8e1', 'snapshot-diff-tracked.wasm': 'fb69ccf0818caa9199ac3f357435528622413b690af90a353b99c88d81adb5c2'}

base_expected = {
    'emulators.js': '066176a9e9e6babfb5388552a5154f3c1f81ed778af3bf4a1f9f904161e3c4bb',
    'LICENSE': '8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643',
    'snapshot-diff.wasm': '20235d6360a49d633f2db03832ef5ad3fbe6daffd4f44e4d7f8e790875a4662f',
}
digest = lambda content: hashlib.sha256(content).hexdigest()
metadata = json.loads((source / 'candidate.json').read_text(encoding='utf-8'))
if metadata['files'] != expected or metadata['th04_idle_fusion'] or not metadata['th05_idle_fusion'] or metadata['native_frame_presentation']:
    raise RuntimeError('Frozen TH05 runtime identity changed')
contents = {name: (source / name).read_bytes() for name in expected}
for name, content in contents.items():
    if digest(content) != expected[name]:
        raise RuntimeError(f'Frozen TH05 runtime changed: {name}')
for name, checksum in base_expected.items():
    if digest((target / name).read_bytes()) != checksum:
        raise RuntimeError(f'Base runtime changed: {name}')

previous = json.loads((target / 'runtime.json').read_text(encoding='utf-8'))
backup = root / 'build/runtime-backups' / previous['files']['wdosbox-x-rollback.wasm']
if not backup.exists():
    shutil.copytree(target, backup)
for name, content in contents.items():
    (target / name).write_bytes(content)
previous.update(
    protocol='th05-netplay/6',
    reference='TH05 guarded VSync idle fusion 20261015; common native optimizations retained',
    runtime_tested=False,
    native_scheduling=True, guarded_synchronous_cpu=True,
    chunked_memcmp=True, pc98_planar_table=True,
    th04_idle_fusion=False, th05_idle_fusion=True, native_frame_presentation=False,
    frozen_source=source.relative_to(root).as_posix(),
    tracked_derived_from=expected['wdosbox-x-rollback.wasm'],
)
previous['files'].update(expected)
(target / 'runtime.json').write_text(json.dumps(previous, indent=2) + chr(10), encoding='utf-8')
(target / 'NOTICE.md').write_text(chr(10).join([
    '# TH05 LAN DOSBox-X runtime', '',
    'DOSBox-X and js-dos emulators@8.5.2 are distributed under GPL-2.0; see LICENSE. '
    'The TH05 local JSPI runtime remains separate. Full Asyncify preserves the complete PC-98 BIOS continuation.', '',
    'The ordinary network entry uses the frozen TH05 idle-optimized native runtime (20261015): '
    'native intra-frame scheduling, guarded synchronous CPU, chunked memcmp and PC-98 planar lookup table. '
    'Both interpreter paths fuse the verified TH05 VSync loop after runtime address registration, with unchanged instruction budgets. '
    'Native RGBA presentation is disabled. CPU remains Simple, fixed 30000 cycles.', '',
    'Source package: vendor-source/emulators-8.5.2.tgz. Native build lineage: '
    'th04-coop-lab/tools/patch_native_scheduler.py and build_native_scheduler.ps1; '
    'TH05 adaptation/derivation: tools/build_native_candidate.cjs and tools/build_th05_idle.mjs. '
    'The tracked binary is derived from the final TH05 untracked binary with TH04 build_dirty_core.mjs / '
    'prepare_dirty_runtime.cjs (Binaryen 132), not copied from the TH04 release. '
    'tools/build_lan_runtime.py publishes only the pinned frozen five-file set and backs up the preceding release. '
    'Hashes and enabled features are in runtime.json.', '',
    'Rollback remains optional, off by default, with two adjacent predicted ticks sharing a complete checkpoint. '
    'The tracked core journals native/host writes in a 64 KiB memory; unsupported engines use the standard core '
    'and full-copy fallback. The packed page-undo helper source is tools/snapshot-diff.wat; '
    'assemble with Binaryen 132 wasm-as --enable-multimemory --enable-bulk-memory --enable-simd.', '',
]), encoding='utf-8')
print('Published pinned TH05 idle-optimized native runtime; previous assets:', backup)
