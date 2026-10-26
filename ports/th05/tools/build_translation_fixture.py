"""Private ending-entry fixtures; never writes production web resources."""
import gzip
import json
import struct
import subprocess
from build_solo_assets import build_exe, ROOT, BASE
from disk_image import Fat12


def build():
    disk = Fat12(gzip.decompress((ROOT / 'baseline/5-cn.hdi.gz').read_bytes()))
    original = disk.read(disk.files()['KAIKI/MAIN.EXE'])
    nasm = ROOT.parent / 'th04-coop-lab/tools/nasm-2.16.03/nasm.exe'
    for profile, sequence in (('bad', 254), ('good', 255), ('extra', 253)):
        subprocess.run([str(nasm), '-f', 'bin', 'patches/frame-replay.asm',
                        '-o', f'build/translation-{profile}.bin', f'-DREPLAY_TEST_SEQUENCE={sequence}'], cwd=ROOT, check=True)
        payload = (ROOT / f'build/translation-{profile}.bin').read_bytes()
        _, load, frame, _, _, _ = struct.unpack('<6H', payload[-12:])
        exe, patch = build_exe(original, payload, 'cn')
        exe = bytearray(exe)
        hsize = struct.unpack_from('<H', exe, 8)[0] * 16
        for at, expected, target in ((0xae3b, bytes.fromhex('e8e037'), load),
                                      (0xaed7, bytes.fromhex('ff1656c6'), frame)):
            assert exe[hsize + at:hsize + at + len(expected)] == expected
            exe[hsize + at:hsize + at + len(expected)] = b'\xe8' + struct.pack('<H', (BASE + target - at - 3) & 65535) + b'\x90' * (len(expected) - 3)
        (ROOT / f'build/translation-{profile}.exe').write_bytes(exe)
        (ROOT / f'build/translation-{profile}.json').write_text(json.dumps(patch))


if __name__ == '__main__':
    build()
