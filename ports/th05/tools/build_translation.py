"""Port the supplied uth05win translation to the original PC-98 resources."""
from pathlib import Path
import gzip
import hashlib
import json
import struct
from PIL import Image
from disk_image import Fat12
from th05_archive import Th05Archive

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'patches/translation'


def dialog_parts(data):
    offsets = struct.unpack_from('<5H', data)
    assert offsets[0] == 10 and offsets[-1] == len(data)
    for start, end in zip(offsets, offsets[1:]):
        parts, pos = [], start
        while pos < end:
            op = data[pos]
            if op == 13:
                stop = data.index(255, pos + 1, end)
                parts.append(('text', data[pos + 1:stop]))
                pos = stop + 1
            else:
                stop = pos + {2: 2, 6: 6, 9: 2, 10: 2, 12: 2}.get(op, 1)
                if op in (3, 5):
                    stop = data.index(0, pos + 1, end) + 1
                assert op in (0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 14, 255), (pos, op)
                parts.append(('op', data[pos:stop]))
                pos = stop
        assert pos == end
        yield parts


def text_chars(data):
    pos = 0
    while pos < len(data):
        if data[pos] == 12:
            yield data[pos:pos + 2]
            pos += 2
        elif data[pos] == 11:
            yield data[pos:pos + 1]
            pos += 1
        else:
            pair = data[pos:pos + 2]
            yield '\u3000' if pair == b'  ' else pair.decode('gbk')
            pos += 2


def sjis_jis(code):
    a, b = code
    row = (a - (0x81 if a < 0xa0 else 0xc1)) * 2 + 0x21
    if b >= 0x9f:
        return row + 1, b - 0x7e
    return row, b - (0x20 if b >= 0x80 else 0x1f)


class Translation:
    def __init__(self):
        source = (SOURCE / 'chs.dat').read_bytes()
        assert hashlib.sha256(source).hexdigest() == '576f297a7240ebc13174863a0d7aee35e0d0d13a834bb1d0b62f7e8e39a0cd0e', 'Translation source changed'
        self.mod = Th05Archive(source)
        self.members = {n: self.mod.read(n) for n in self.mod.entries}
        chars = set()
        for name, content in self.members.items():
            if name.endswith('.TX2'):
                for block in dialog_parts(content):
                    for kind, text in block:
                        if kind == 'text':
                            chars.update(c for c in text_chars(text) if isinstance(c, str))
            elif name.endswith('.TXT'):
                chars.update(content.decode('gbk'))
        self.mapping = {}
        custom = iter(bytes((a, b)) for a in range(0xeb, 0xf0)
                      for b in range(0x40, 0xfd) if b != 0x7f
                      and sjis_jis(bytes((a, b)))[0] not in (0x76, 0x77))
        for char in sorted(chars):
            if ord(char) < 128:
                continue
            try:
                code = char.encode('cp932')
                assert len(code) == 2 and code.decode('cp932') == char
                assert sjis_jis(code)[0] < 0x75
            except (UnicodeError, AssertionError):
                code = next(custom)
            self.mapping[char] = code

    def encode(self, text):
        return b''.join(c.encode('ascii') if ord(c) < 128 else self.mapping[c] for c in text)

    def dialog(self, content):
        blocks = []
        for parts in dialog_parts(content):
            block = bytearray()
            for kind, data in parts:
                if kind == 'op':
                    block.extend(data)
                    continue
                block.append(13)
                for char in text_chars(data):
                    block.extend(self.encode(char) if isinstance(char, str) else char)
                block.append(255)
            blocks.append(bytes(block))
        offsets = [10]
        for block in blocks:
            offsets.append(offsets[-1] + len(block))
        return struct.pack('<5H', *offsets) + b''.join(blocks)

    def lines(self, name):
        return self.members[name].decode('gbk').replace('\r\r\n', '\n').replace('\r\n', '\n').splitlines()

    def resources(self, disk):
        changed = []
        files = disk.files()
        for archive_name in ('KAIKI/怪綺談1.DAT', 'KAIKI/怪綺談2.DAT'):
            archive = Th05Archive(disk.read(files[archive_name]))
            replacements = {}
            for name, content in self.members.items():
                if name not in archive.entries:
                    continue
                if name.endswith('.TX2'):
                    replacements[name] = self.dialog(content)
                elif name.startswith('_ED') and name.endswith('.TXT'):
                    text = content.decode('gbk').replace('\r\r\n', '\r\n')
                    replacements[name] = self.encode(text)
            titles = [line for line in self.lines('NAMES.TXT') if line]
            for stage in range(7):
                name = f'ST{stage:02}.STD'
                if name not in archive.entries:
                    continue
                content = bytearray(archive.read(name))
                pos = 2
                for title in titles[stage * 3:stage * 3 + 3]:
                    end = content.index(0, pos)
                    encoded = self.encode(title)
                    assert len(encoded) <= end - pos, (name, title, len(encoded), end - pos)
                    content[pos:end] = encoded.ljust(end - pos, b' ')
                    pos = end + 1
                replacements[name] = bytes(content)
            disk.replace(files[archive_name], archive.replace(replacements))
            changed.append(archive_name)
        font = gzip.decompress((SOURCE / 'CNFONT.BMP.gz').read_bytes())
        disk.add_root('CNFONT.BMP', font)
        changed.append('CNFONT.BMP')
        op, _ = self.op_strings(disk.read(files['KAIKI/OP.EXE']))
        disk.replace(files['KAIKI/OP.EXE'], op)
        changed.append('KAIKI/OP.EXE')
        return changed

    def op_strings(self, exe):
        from unpack_translation_op import unpack, executable
        image, relocations, ss, sp = unpack(exe)
        result = bytearray(image)
        menu = [line for line in self.lines('MENUDESC.TXT') if line]
        replacements = {0xf0e7: menu[6].split('（')[0], 0xf0fa: menu[0],
                        0xf119: menu[2], 0xf136: menu[3].split('(')[0],
                        0xf147: menu[4], 0xf15e: '返回ＤＯＳ',
                        0xf22b: menu[10], 0xf262: menu[11],
                        0xf2c7: menu[12].split('(')[0], 0xf2fb: menu[13].split('(')[0],
                        0xf378: menu[14].split('(')[0], 0xf3a5: menu[15].split('(')[0],
                        0xf3c8: menu[16]}
        for at, text in zip((0xf16f, 0xf19e, 0xf1cd, 0xf1fc), menu[17:21]):
            replacements[at] = text
        for at, text in zip((0xf3df, 0xf3fe, 0xf41d, 0xf43a), menu[6:10]):
            replacements[at] = text
        for at, text in replacements.items():
            end = result.index(0, at)
            encoded = self.encode(text)
            if len(encoded) > end - at:
                encoded = self.encode(text.replace(' ', ''))
            assert len(encoded) <= end - at, (hex(at), text, len(encoded), end - at)
            result[at:end] = encoded.ljust(end - at, b' ')
        return executable(bytes(result), relocations, ss, sp), {'strings': len(replacements)}

    def main_strings(self, exe):
        result = bytearray(exe)
        summary = [line for line in self.lines('SUMMARY.TXT') if line]
        # The Windows port adds an Extra coefficient absent from the native table.
        del summary[11]
        pos = 0x23431
        for text in summary:
            end = result.index(0, pos)
            encoded = self.encode(text)
            if len(encoded) > end - pos:
                encoded = self.encode(text.strip())
            assert len(encoded) <= end - pos, (text, len(encoded), end - pos)
            result[pos:end] = encoded.ljust(end - pos, b' ')
            pos = end + 1
        titles = [line for line in self.lines('NAMES.TXT') if line]
        for pos, text in ((0x232b0, titles[-1]), (0x232d8, titles[-2])):
            end = result.index(0, pos)
            encoded = self.encode(text)
            assert len(encoded) <= end - pos
            result[pos:end] = encoded.ljust(end - pos, b' ')
        return bytes(result)


def prepare():
    SOURCE.mkdir(parents=True, exist_ok=True)
    supplied = ROOT.parent / 'uth05win/chs.dat'
    (SOURCE / 'chs.dat').write_bytes(supplied.read_bytes())
    translation = Translation()
    needed = {ord(c) for c in translation.mapping}
    glyphs = {}
    with gzip.open(ROOT / 'build/unifont-15.1.05.hex.gz', 'rt', encoding='ascii') as source:
        for line in source:
            code, bitmap = line.strip().split(':')
            if int(code, 16) in needed:
                glyphs[chr(int(code, 16))] = bytes.fromhex(bitmap)
    assert set(glyphs) == set(translation.mapping), sorted(set(translation.mapping) - set(glyphs))
    image = Image.open(ROOT.parent / 'uth05win/uth05win/anex86.bmp').convert('1')
    for char, code in translation.mapping.items():
        row, column = sjis_jis(code)
        x, y = (row - 0x20) * 16, column * 16
        bitmap = glyphs[char]
        width = len(bitmap) // 2
        assert width in (8, 16), (char, len(bitmap))
        for dy in range(16):
            bits = int.from_bytes(bitmap[dy * (width // 8):(dy + 1) * (width // 8)], 'big')
            for dx in range(16):
                image.putpixel((x + dx, y + dy), 0 if dx < width and bits & (1 << (width - dx - 1)) else 255)
    from io import BytesIO
    output = BytesIO()
    image.save(output, format='BMP')
    (SOURCE / 'CNFONT.BMP.gz').write_bytes(gzip.compress(output.getvalue(), mtime=0))
    (SOURCE / 'mapping.json').write_text(json.dumps({c: code.hex() for c, code in translation.mapping.items()}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (SOURCE / 'unifont-subset.hex').write_text(''.join(f'{ord(c):04X}:{glyphs[c].hex().upper()}\n' for c in sorted(glyphs)), encoding='ascii')
    report = {'source': '../uth05win/chs.dat', 'sha256': hashlib.sha256(supplied.read_bytes()).hexdigest(),
              'members': {n: len(c) for n, c in translation.members.items()}, 'glyphs': len(glyphs)}
    (SOURCE / 'source.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    prepare()
