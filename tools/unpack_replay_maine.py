"""Audited DIET unpack of the frozen TH05 MAINE, for replay-only overlays.

Execute only the decompressor in Unicorn. Capture its relocation operations,
then reconstruct a conventional MZ. The game itself is never run by this tool.
"""
import hashlib
import struct
from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE, UC_HOOK_INTR
from unicorn.x86_const import UC_X86_REG_CS, UC_X86_REG_IP, UC_X86_REG_SS, UC_X86_REG_SP, UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_BX, UC_X86_REG_BP

SOURCE_MD5 = '2c539d61f4dd8c864df0b7885181b8db'
IMAGE_SIZE = 0x128a6


def unpack_at(exe, segment):
    assert hashlib.md5(exe).hexdigest() == SOURCE_MD5, 'Unaudited MAINE'
    fields = struct.unpack_from('<14H', exe)
    assert fields[3] == 0 and exe[28:32] == b'diet'
    origin = segment * 16
    machine = Uc(UC_ARCH_X86, UC_MODE_16)
    machine.mem_map(0, 0x200000)
    machine.mem_write(origin, exe[fields[4] * 16:])
    machine.mem_write(origin - 16 + 2, struct.pack('<H', 0x9000))
    for reg, value in [(UC_X86_REG_CS, segment), (UC_X86_REG_SS, segment + fields[7]),
                       (UC_X86_REG_SP, fields[8]), (UC_X86_REG_DS, segment - 1),
                       (UC_X86_REG_ES, segment - 1)]:
        machine.reg_write(reg, value)
    relocations, result = [], {}
    ticks = 0

    def instruction(cpu, address, size, _):
        nonlocal ticks
        ticks += 1
        if address == origin + 0x135a8:
            assert bytes(cpu.mem_read(address, 3)) == bytes.fromhex('26012f')
            assert cpu.reg_read(UC_X86_REG_BP) == segment
            relocations.append(cpu.reg_read(UC_X86_REG_ES) * 16 + cpu.reg_read(UC_X86_REG_BX) - origin)
        if address == origin and ticks > 1:
            result.update(image=bytearray(cpu.mem_read(origin, IMAGE_SIZE)),
                          ss=cpu.reg_read(UC_X86_REG_SS) - segment,
                          sp=cpu.reg_read(UC_X86_REG_SP))
            cpu.emu_stop()

    def interrupt(cpu, number, _):
        raise RuntimeError(f'Unexpected interrupt while unpacking: {number:02x}')

    machine.hook_add(UC_HOOK_CODE, instruction)
    machine.hook_add(UC_HOOK_INTR, interrupt)
    machine.emu_start(origin, 0x1fffff, count=1200000)
    assert result and len(relocations) == len(set(relocations)), 'Unpack incomplete'
    image = result['image']
    for at in relocations:
        assert 0 <= at < len(image) - 1
        struct.pack_into('<H', image, at, (struct.unpack_from('<H', image, at)[0] - segment) & 65535)
    return bytes(image), sorted(relocations), result['ss'], result['sp']


def unpack(exe):
    first = unpack_at(exe, 0x1010)
    assert first == unpack_at(exe, 0x2010), 'Relocation reconstruction is not load independent'
    image, relocations, ss, sp = first
    assert image[:3] == bytes.fromhex('ba1110') and ss == 0x1c68 and sp == 0x80
    return image, relocations, ss, sp
