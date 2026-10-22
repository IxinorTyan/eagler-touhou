"""Reconstruct OP's DIET image at two load bases before translating strings."""
import hashlib
import struct
from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE, UC_HOOK_INTR
from unicorn.x86_const import UC_X86_REG_CS, UC_X86_REG_SS, UC_X86_REG_SP, UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_BX, UC_X86_REG_BP


def unpack_at(exe, segment):
    assert hashlib.md5(exe).hexdigest() == '50eac6e4a1e1fecf0c2afe8872519a84'
    fields = struct.unpack_from('<14H', exe)
    origin = segment * 16
    cpu = Uc(UC_ARCH_X86, UC_MODE_16)
    cpu.mem_map(0, 0x200000)
    cpu.mem_write(origin, exe[fields[4] * 16:])
    cpu.mem_write(origin - 16 + 2, struct.pack('<H', 0x9000))
    for reg, value in ((UC_X86_REG_CS, segment), (UC_X86_REG_SS, segment + fields[7]),
                       (UC_X86_REG_SP, fields[8]), (UC_X86_REG_DS, segment - 1),
                       (UC_X86_REG_ES, segment - 1)):
        cpu.reg_write(reg, value)
    relocations, result = [], {}
    ticks = 0

    def instruction(machine, address, size, _):
        nonlocal ticks
        ticks += 1
        if bytes(machine.mem_read(address, 3)) == b'\x26\x01\x2f':
            assert machine.reg_read(UC_X86_REG_BP) == segment
            relocations.append(machine.reg_read(UC_X86_REG_ES) * 16 + machine.reg_read(UC_X86_REG_BX) - origin)
        if address == origin and ticks > 1:
            ss = machine.reg_read(UC_X86_REG_SS) - segment
            sp = machine.reg_read(UC_X86_REG_SP)
            result.update(image=bytearray(machine.mem_read(origin, 0x12800)), ss=ss, sp=sp)
            machine.emu_stop()

    def interrupt(machine, number, _):
        raise RuntimeError(f'Unexpected decompressor interrupt {number:02x}')

    cpu.hook_add(UC_HOOK_CODE, instruction)
    cpu.hook_add(UC_HOOK_INTR, interrupt)
    cpu.emu_start(origin, 0x1fffff, count=1500000)
    assert result and len(relocations) == len(set(relocations))
    for at in relocations:
        struct.pack_into('<H', result['image'], at, (struct.unpack_from('<H', result['image'], at)[0] - segment) & 65535)
    return bytes(result['image']), sorted(relocations), result['ss'], result['sp']


def unpack(exe):
    first = unpack_at(exe, 0x1010)
    assert first == unpack_at(exe, 0x2010), 'OP unpack depends on load address'
    return first


def executable(image, relocations, ss, sp):
    header_size = (32 + 4 * len(relocations) + 15) & ~15
    size = header_size + len(image)
    header = bytearray(header_size)
    minimum = max(0, (ss * 16 + sp + 0x100 - ((len(image) + 15) & ~15) + 15) // 16)
    struct.pack_into('<14H', header, 0, 0x5a4d, size % 512, (size + 511) // 512,
                     len(relocations), header_size // 16, minimum, 0xffff, ss, sp, 0, 0, 0, 32, 0)
    for i, at in enumerate(relocations):
        struct.pack_into('<2H', header, 32 + i * 4, at % 16, at // 16)
    return bytes(header) + image
