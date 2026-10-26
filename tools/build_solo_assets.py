"""Build original TH05 solo disks with TH04-style single-player input hooks."""
from pathlib import Path
import gzip
import hashlib
import json
import struct
import subprocess
from disk_image import Fat12
from build_translation import Translation

ROOT = Path(__file__).resolve().parents[1]
BASE, INSERT = 0xae10, 0x14ab0
MAIN_MD5 = {'jp': '952585e02435c3b3b111975a78b05983',
            'cn': '553eee5ff79429f45284913870380549'}
ENTRY_NAMES = ('init_hook', 'update_hook', 'touch_move', 'pause_hook', 'world_hook', 'mailbox')


def build_exe(exe, payload, language):
    assert hashlib.md5(exe).hexdigest() == MAIN_MD5[language], 'Unsupported original MAIN.EXE'
    hsize = struct.unpack_from('<H', exe, 8)[0] * 16
    header, original = bytearray(exe[:hsize]), exe[hsize:]
    image, code = bytearray(original), bytearray(payload)
    if language == 'cn':
        image[:] = Translation().main_strings(exe)[hsize:]
    assert original[0xae1e:0xae2a] == bytes.fromhex('558beca17a263b066a5772f7'), 'Original VSync wait changed'
    gap = (len(code) + 15) & ~15
    assert INSERT - BASE + gap < 65536
    assert original[INSERT - 6:INSERT + 8] == bytes.fromhex('57b810ac8ec0bfb436e84abb5fc3')
    code[:8] = original[INSERT:INSERT + 8]
    entries = dict(zip(ENTRY_NAMES, struct.unpack_from('<6H', code, 16)))
    table, count = struct.unpack_from('<H', header, 24)[0], struct.unpack_from('<H', header, 6)[0]
    for i in range(count):
        off, seg = struct.unpack_from('<HH', header, table + i * 4)
        location = seg * 16 + off
        target = struct.unpack_from('<H', image, location)[0]
        if target * 16 >= INSERT:
            struct.pack_into('<H', image, location, target + gap // 16)
        moved = location + (gap if location >= INSERT else 0)
        struct.pack_into('<HH', header, table + i * 4, moved % 16, moved // 16)
    for field in (14, 22):
        segment = struct.unpack_from('<H', header, field)[0]
        if segment * 16 >= INSERT:
            struct.pack_into('<H', header, field, segment + gap // 16)
    hooks = []
    for at, target, name in [(0xb309, 0xb55a, 'init_hook'), (0xaef9, 0xcc3d, 'update_hook'),
                             (0xccda, 0xcad2, 'touch_move'), (0xaecb, 0xb637, 'pause_hook'),
                             (0xae8c, 0xaea6, 'world_hook')]:
        expected = b'\xe8' + struct.pack('<H', (target - at - 3) & 65535)
        assert original[at:at + 3] == expected, (language, name, hex(at))
        image[at:at + 3] = b'\xe8' + struct.pack('<H', (BASE + entries[name] - at - 3) & 65535)
        hooks.append({'name': name, 'image_offset': at, 'original': expected.hex(), 'entry': entries[name]})
    image[INSERT:INSERT] = code + bytes(gap - len(code))
    size = len(header) + len(image)
    struct.pack_into('<HH', header, 2, size % 512, (size + 511) // 512)
    result = bytes(header + image)
    patch = {'signature': 'TH05SOLOINPUTv1!', 'mailbox_size': 36,
             'code_segment': BASE // 16, 'data_segment': 0x209d + gap // 16,
             'mailbox_cs_offset': entries['mailbox'], 'entries': entries,
             'insert_size': gap, 'hooks': hooks, 'source_main_md5': MAIN_MD5[language],
             'main_sha256': hashlib.sha256(result).hexdigest(), 'changed_files': ['KAIKI/MAIN.EXE']}
    return result, patch


def main():
    from runpy import run_path
    run_path(str(ROOT.parent/'tools/native_boss_hud_build_guard.py'))['protect'](ROOT/'web')
    out = ROOT / 'build'
    out.mkdir(exist_ok=True)
    touch = (ROOT / 'patches/touch.asm').read_text(encoding='utf-8')
    touch = touch[touch.index('touch_move:'):touch.index('; Discard pending movement')]
    old = '    movzx bx,byte [cs:active_player]\n    shl bx,3'
    assert touch.count(old) == 1
    touch = touch.replace(old, '    xor bx,bx\n    cmp byte [cs:mode],1\n    jne .clear\n    cmp byte [cs:flags],0\n    jne .clear')
    (out / 'solo-touch.inc').write_text(touch, encoding='utf-8')
    nasm = ROOT.parent / 'th04-coop-lab/tools/nasm-2.16.03/nasm.exe'
    subprocess.run([str(nasm), '-f', 'bin', 'patches/solo.asm', '-o', 'build/solo.bin',
                    '-l', 'build/solo.lst'], cwd=ROOT, check=True)
    payload = (out / 'solo.bin').read_bytes()
    manifest = {'game': 'TH05', 'mode': 'original-solo', 'inputVersion': 1, 'languages': {}}
    for language in ('cn', 'jp'):
        source = ROOT / f'baseline/5-{language}.hdi.gz'
        disk = Fat12(gzip.decompress(source.read_bytes()))
        entry = disk.files()['KAIKI/MAIN.EXE']
        exe, patch = build_exe(disk.read(entry), payload, language)
        disk.replace(entry, exe)
        if language == 'cn':
            patch['changed_files'] += Translation().resources(disk)
        data = bytes(disk.data)
        target = ROOT / f'web/th05-solo-{language}.hdi.gz'
        target.write_bytes(gzip.compress(data, mtime=0))
        manifest['languages'][language] = {
            'url': target.name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'source': f'baseline/{source.name}', 'inputPatch': patch,
        }
    (ROOT / 'web/solo-disks.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Built CN/JP original solo disks with single-player touch/status hooks.')


if __name__ == '__main__':
    main()
