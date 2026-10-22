"""Read and replace members of TH05's encrypted DAT resource archives."""
import struct


class Th05Archive:
    def __init__(self, data):
        self.data = bytes(data)
        size = struct.unpack_from('<H', data)[0]
        key = data[6]
        self.table = bytearray(data[16:16 + size])
        for i in range(size):
            self.table[i] ^= key
            key = (key - self.table[i]) & 255
        self.entries = {}
        for at in range(0, size, 32):
            kind = struct.unpack_from('<H', self.table, at)[0]
            if not kind:
                break
            assert kind in (0xf388, 0x9595), (at, kind)
            name = self.table[at + 3:at + 16].split(b'\0')[0].decode('ascii').upper()
            self.entries[name] = at

    def read(self, name):
        at = self.entries[name.upper()]
        kind, key = struct.unpack_from('<HB', self.table, at)
        size, original, offset = struct.unpack_from('<HHI', self.table, at + 16)
        packed = bytes(x ^ key for x in self.data[offset:offset + size])
        if kind == 0xf388:
            return packed[:original] if original else packed
        out = bytearray()
        pos, previous = 0, None
        while pos < len(packed):
            value = packed[pos]
            pos += 1
            if value == previous and pos < len(packed):
                out.extend(bytes([value]) * (packed[pos] + 1))
                pos += 1
            else:
                out.append(value)
                previous = value
        assert len(out) >= original, name
        return bytes(out[:original] if original else out)

    def replace(self, replacements):
        table = bytearray(self.table)
        body = bytearray()
        base = 16 + len(table)
        for name, at in self.entries.items():
            if name in replacements:
                content = replacements[name]
                assert len(content) <= 65535, name
                key = table[at + 2]
                packed = bytes(x ^ key for x in content)
                struct.pack_into('<H', table, at, 0xf388)
                struct.pack_into('<HH', table, at + 16, len(content), len(content))
            else:
                size, _, offset = struct.unpack_from('<HHI', table, at + 16)
                packed = self.data[offset:offset + size]
            struct.pack_into('<I', table, at + 20, base + len(body))
            body.extend(packed)
        key = self.data[6]
        encoded = bytearray()
        for value in table:
            encoded.append(value ^ key)
            key = (key - value) & 255
        result = self.data[:16] + encoded + body
        check = Th05Archive(result)
        for name in self.entries:
            assert check.read(name) == replacements.get(name, self.read(name)), name
        return bytes(result)
