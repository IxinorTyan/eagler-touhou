"""Audit source fidelity, control flow, fonts, and final solo/co-op disks."""
import gzip
import hashlib
import json
import re
from io import BytesIO
from PIL import Image
from build_translation import ROOT, SOURCE, Translation, dialog_parts, text_chars, sjis_jis
from disk_image import Fat12
from th05_archive import Th05Archive


def ending_layout(data):
    """Follow native cutscene cursor commands, counting 16-pixel cells."""
    pos = column = row = maximum = 0
    glyphs = wraps = 0
    while pos < len(data):
        byte = data[pos]
        if byte <= 32:
            pos += 1
            continue
        if byte == 92:
            command = chr(data[pos + 1]).lower()
            pos += 2
            if command in ('n', 's'):
                maximum = max(maximum, column)
                column = 0
                row = row + 1 if command == 'n' else 0
                assert row < 4, ('explicit ending line would open an implicit page', pos)
            if command == 'c' and data[pos:pos + 1] == b'=':
                assert len(data[pos + 1:pos + 3]) == 2
                pos += 4  # '=' + two-byte color key + comma
            elif command == 'p':
                match = re.match(rb'(?:,[A-Za-z0-9_.]+|[=@-]|p)', data[pos:])
                if match:
                    pos += match.end()
            elif command in ('m',):
                match = re.match(rb',[A-Za-z0-9_.]+', data[pos:])
                assert match
                pos += match.end()
            elif command in ('w', 'f') and data[pos:pos + 1].lower() in (b'i', b'o', b'm', b'k'):
                pos += 1
            elif command == '=' and data[pos:pos + 1] == b'=':
                pos += 1
            elif command == 's' and data[pos:pos + 1] == b'-':
                pos += 1
            match = re.match(rb'[0-9]*(?:,[0-9]+)?', data[pos:])
            pos += match.end()
            continue
        if byte == 64:
            match = re.match(rb'@(?:!!|!\?|!|\?|[th]|[0-9]*)', data[pos:], re.IGNORECASE)
            assert match
            pos += match.end()
        else:
            assert len(data[pos:pos + 2]) == 2
            pos += 2
        column += 1
        glyphs += 1
        maximum = max(maximum, column)
        if column == 30:
            row += 1
            column = 4  # Native NAME_W = 64 pixels on automatic continuations.
            wraps += 1
            assert row < 4, ('implicit ending page would overwrite text', pos)
    return {'maxLineCells': maximum, 'glyphs': glyphs, 'automaticWraps': wraps}


def audit():
    translation = Translation()
    provenance = json.loads((SOURCE / 'source.json').read_text())
    assert hashlib.sha256((SOURCE / 'chs.dat').read_bytes()).hexdigest() == provenance['sha256']
    assert len(set(translation.mapping.values())) == len(translation.mapping)
    reverse = {v: k for k, v in translation.mapping.items()}
    font = gzip.decompress((SOURCE / 'CNFONT.BMP.gz').read_bytes())
    image = Image.open(BytesIO(font)).convert('1')
    glyphs = {chr(int(line.split(':')[0], 16)): bytes.fromhex(line.split(':')[1])
              for line in (SOURCE / 'unifont-subset.hex').read_text().splitlines()}
    for char, code in translation.mapping.items():
        row, col = sjis_jis(code)
        assert row not in (0x76, 0x77), (char, code.hex())
        bitmap = glyphs[char]
        width = len(bitmap) // 2
        for y in range(16):
            bits = int.from_bytes(bitmap[y * width // 8:(y + 1) * width // 8], 'big')
            for x in range(16):
                expected = x < width and bool(bits & (1 << (width - x - 1)))
                assert (image.getpixel(((row - 0x20) * 16 + x, col * 16 + y)) == 0) == expected
    result = {'sourceSha256': provenance['sha256'], 'glyphs': len(glyphs), 'endingLayout': {}, 'modes': {}}
    japanese = Fat12(gzip.decompress((ROOT / 'baseline/5-jp.hdi.gz').read_bytes()))
    japanese_files = japanese.files()
    japanese_archives = [Th05Archive(japanese.read(japanese_files[f'KAIKI/怪綺談{n}.DAT'])) for n in (1, 2)]
    reference_streams = 0
    for name, content in translation.members.items():
        if not name.endswith('.TX2'):
            continue
        original = next(a for a in japanese_archives if name in a.entries).read(name)
        reference = list(dialog_parts(original))
        converted = list(dialog_parts(translation.dialog(content)))
        assert len(reference) == len(converted) == 4, name
        for character, (native, chinese) in enumerate(zip(reference, converted)):
            # Text may differ, but speaker/cursor, portrait, music and wipe
            # commands must stay at the original places in every stream.
            skeleton = lambda parts: [(kind, data if kind == 'op' else None) for kind, data in parts]
            assert skeleton(native) == skeleton(chinese), (name, character, 'Japanese layout commands changed')
            reference_streams += 1
    result['japaneseLayoutStreams'] = reference_streams
    for name, content in translation.members.items():
        if name.startswith('_ED'):
            result['endingLayout'][name] = ending_layout(translation.encode(content.decode('gbk')))
    solo = json.loads((ROOT / 'web/solo-disks.json').read_text())['languages']['cn']
    for mode, manifest in (('solo', solo), ('local', json.loads((ROOT / 'web/patch-cn.json').read_text()))):
        raw = gzip.decompress((ROOT / f'web/th05-{mode}-cn.hdi.gz').read_bytes())
        assert hashlib.sha256(raw).hexdigest() == manifest['sha256']
        disk = Fat12(raw)
        files = disk.files()
        assert disk.read(files['CNFONT.BMP']) == font
        archives = [Th05Archive(disk.read(files[f'KAIKI/怪綺談{n}.DAT'])) for n in (1, 2)]
        counts = {'dialogFiles': 0, 'dialogBoxes': 0, 'endingFiles': 0}
        for name, content in translation.members.items():
            archive = next((a for a in archives if name in a.entries), None)
            if name.endswith('.TX2'):
                actual = archive.read(name)
                assert actual == translation.dialog(content)
                for original, converted in zip(dialog_parts(content), dialog_parts(actual)):
                    assert len(original) == len(converted)
                    for (kind, source), (kind2, target) in zip(original, converted):
                        assert kind == kind2
                        if kind == 'op':
                            assert source == target
                        else:
                            pos = 0
                            for char in text_chars(source):
                                size = 1 if char == b'\x0b' else 2
                                encoded = target[pos:pos + size]
                                assert (reverse[encoded] if isinstance(char, str) else encoded) == char
                                pos += size
                            assert pos == len(target)
                            lines = [list(text_chars(line)) for line in source.split(b'\x0b')]
                            assert max(map(len, lines)) <= 18
                            assert sum(bool(line) for line in lines) <= 3
                            counts['dialogBoxes'] += 1
                counts['dialogFiles'] += 1
            elif name.startswith('_ED') and name.endswith('.TXT'):
                assert archive.read(name) == translation.encode(content.decode('gbk').replace('\r\r\n', '\r\n'))
                counts['endingFiles'] += 1
        assert counts['dialogFiles'] == 9 and counts['endingFiles'] == 12
        baseline = Fat12(gzip.decompress((ROOT / 'baseline/5-cn.hdi.gz').read_bytes()))
        for old_archive, current in zip((Th05Archive(baseline.read(baseline.files()[f'KAIKI/怪綺談{n}.DAT'])) for n in (1, 2)), archives):
            for name in old_archive.entries:
                if name not in translation.members and not name.endswith('.STD'):
                    assert old_archive.read(name) == current.read(name), name
        result['modes'][mode] = counts
    assert disk.read(files['KAIKI/OP.EXE']) == Fat12(gzip.decompress((ROOT / 'web/th05-solo-cn.hdi.gz').read_bytes())).read(
        Fat12(gzip.decompress((ROOT / 'web/th05-solo-cn.hdi.gz').read_bytes())).files()['KAIKI/OP.EXE'])
    (ROOT / 'reports/translation-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    audit()
