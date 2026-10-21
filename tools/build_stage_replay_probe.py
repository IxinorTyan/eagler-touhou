"""Isolated stage-boundary experiment. Original release resources are preserved; optional stage assets publish separately."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import os
import struct
import json
import hashlib

ROOT = Path(__file__).resolve().parents[1]
TRACE = os.environ.get('TH05_STAGE_TRACE') == '1'
WATCH = os.environ.get('TH05_STAGE_WATCH') == '1'
OUT = ROOT / ('build/stage-watch' if WATCH else 'build/stage-replay-probe-trace' if TRACE else 'build/stage-replay-probe')

def main():
    assert OUT.resolve().is_relative_to((ROOT / 'build').resolve())
    protected = [ROOT / 'build/local.bin', ROOT / 'patches/local.asm', ROOT / 'patches/shot-layout.inc']
    protected += [ROOT / 'web' / name for name in (
        'patch-cn.json', 'patch-jp.json', 'th05-local-cn.hdi.gz', 'th05-local-jp.hdi.gz',
        'vendor/dosbox-net/runtime.json', 'vendor/dosbox-net/wdosbox-x-rollback.wasm')]
    fingerprints = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in protected}
    baseline_payload = (ROOT / 'build/local.bin').read_bytes().index(b'PS05')
    baseline_gap = (baseline_payload + 15) & ~15
    for language in ('cn', 'jp'):
        manifest = json.loads((ROOT / f'web/patch-{language}.json').read_text())
        assert manifest['insert_size'] == baseline_gap and manifest['payload_bytes'] == baseline_payload
    for name in ('patches', 'baseline'):
        shutil.copytree(ROOT / name, OUT / name, dirs_exist_ok=True)
    for name in ('build', 'web'):
        (OUT / name).mkdir(parents=True, exist_ok=True)
    (OUT / 'web/assets').mkdir(exist_ok=True)
    shutil.copy2(ROOT / 'web/assets/yuuka-afterimages.json', OUT / 'web/assets/yuuka-afterimages.json')
    for item in (ROOT / 'build').iterdir():
        if item.is_file() and item.suffix in ('.bin', '.COM', '.inc'):
            shutil.copy2(item, OUT / 'build' / item.name)
    source = (OUT / 'patches/local.asm').read_text()
    def marker(port):
        return f'''    pushfd
    pushad
    xor eax,eax
    mov ax,ds
    shl eax,16
    mov ax,cs
    mov dx,{port}
    out dx,eax
    popad
    popfd
'''
    needle = 'init_hook:\n    call ORIGINAL(0xb55a)\n'
    assert source.count(needle) == 1
    source = source.replace(needle, 'init_hook:\n' + marker('0x7fe0') + '    call ORIGINAL(0xb55a)\n' + marker('0x7fe1'))
    source = source.replace('update_hook:\n', 'update_hook:\n' + marker('0x7fe2'))
    if WATCH:
        # Observe the common return of input_sense itself. Both far callers
        # and SHARED push-CS/near callers (dialog waits) must be covered.
        source = source.replace('payload_end:\n', 'stage_sense:\n' + marker('0x7fe4') + '''    mov ax,[0x3064]
    retf
db 'ST05POLL'
dw stage_sense
payload_end:
''')
    if TRACE:
        source = source.replace('payload_end:\n', "db 'ST05RING'\nring_probe:\n" + marker('0x7fe3') + '    inc byte [0x3626]\n    ret\npayload_end:\n')
    (OUT / 'patches/local.asm').write_text(source)
    nasm = ROOT.parent / 'th04-coop-lab/tools/nasm-2.16.03/nasm.exe'
    subprocess.run([str(nasm), '-f', 'bin', 'patches/local.asm', '-o', 'build/local.bin'], cwd=OUT, check=True)
    payload = (OUT / 'build/local.bin').read_bytes().index(b'PS05')
    delta = ((payload + 15) & ~15) - baseline_gap
    assert 0 < delta < 256
    # Derive the exact padding change, including the optional trace wrapper.
    # A guessed allowance changes the sprite allocator and invalidates parity.
    layout = (OUT / 'patches/shot-layout.inc').read_text()
    for budget in (315328, 393904):
        assert layout.count(f'{budget}-') == 1
        layout = layout.replace(f'{budget}-', f'{budget+delta}-')
    (OUT / 'patches/shot-layout.inc').write_text(layout)
    subprocess.run([str(nasm), '-f', 'bin', 'patches/local.asm', '-o', 'build/local.bin'], cwd=OUT, check=True)
    assert (OUT / 'build/local.bin').read_bytes().index(b'PS05') == payload
    spec = importlib.util.spec_from_file_location('stage_probe_builder', ROOT / 'tools/build_local.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = OUT
    module.COMBINED_BUDGET = {n: budget+delta for n, budget in module.COMBINED_BUDGET.items()}
    if WATCH:
        upstream = module.apply_performance
        def observe_inputs(image, payload, base):
            result = upstream(image, payload, base)
            target = struct.unpack_from('<H', payload, payload.index(b'ST05POLL') + 8)[0]
            at = 0x14ab0 + 0x613
            assert image[at:at+5] == bytes.fromhex('a16430cb90')
            image[at:at+5] = b'\xea' + struct.pack('<HH', target, 0xae1)
            return result
        module.apply_performance = observe_inputs
        # Add the far jump's segment relocation using the builder's final
        # relocation append just before serialization.
        code = (ROOT / 'tools/build_local.py').read_text()
        needle = "    performance_hooks = apply_performance(image, payload, BASE)\n"
        assert code.count(needle) == 1
        code = code.replace(needle, needle + "    if b'ST05POLL' in payload:\n        relocations.append(INSERT+gap+0x616)\n")
        # Preserve the module's overridden ROOT and instrumentation function.
        namespace = {'__file__': str(ROOT / 'tools/build_local.py'), '__name__': 'stage_watch_builder'}
        exec(compile(code, str(ROOT / 'tools/build_local.py'), 'exec'), namespace)
        module.build = namespace['build']
        module.build.__globals__.update(ROOT=OUT, COMBINED_BUDGET=module.COMBINED_BUDGET, apply_performance=observe_inputs)
    if TRACE:
        upstream = module.apply_performance
        def instrument(image, payload, base):
            result = upstream(image, payload, base)
            entry = module.INSERT - base + payload.index(b'ST05RING') + 8
            for at in (0xc708, 0xc716, 0xc72c):
                assert image[at:at+4] == bytes.fromhex('fe062636')
                image[at:at+4] = b'\xe8' + struct.pack('<H', (entry-(at-base)-3)&65535) + b'\x90'
            return result
        module.apply_performance = instrument
    for language in ('cn', 'jp'):
        module.build(language)
        expected = json.loads((ROOT / f'web/patch-{language}.json').read_text())
        actual = json.loads((OUT / f'web/patch-{language}.json').read_text())
        assert actual['heap_by_players'] == expected['heap_by_players']
        if WATCH:
            import sys
            actual.update(stage_observation=1, stage_disk=f'th05-stage-{language}.hdi.gz')
            (OUT / f'web/patch-{language}.json').write_text(json.dumps(actual, indent=2))
            if '--publish' in sys.argv:
                shutil.copy2(OUT / f'web/th05-local-{language}.hdi.gz', ROOT / f'web/th05-stage-{language}.hdi.gz')
                shutil.copy2(OUT / f'web/patch-{language}.json', ROOT / f'web/patch-stage-{language}.json')
    assert all(hashlib.sha256(path.read_bytes()).hexdigest() == sha for path, sha in fingerprints.items())
    print('Research disks only:', OUT, 'marker padding:', delta, 'heaps and production files verified')

if __name__ == '__main__':
    main()
