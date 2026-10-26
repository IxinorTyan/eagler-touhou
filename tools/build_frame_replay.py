"""Separate replay MAIN overlays; leave the normal solo disks unchanged."""
import gzip,hashlib,json,struct,subprocess
from pathlib import Path
from disk_image import Fat12
from build_solo_assets import build_exe,BASE
from unpack_replay_maine import unpack
ROOT=Path(__file__).resolve().parents[1]

def build_ending(exe,nasm):
    original,relocations,ss,sp=unpack(exe)
    subprocess.run([str(nasm),'-f','bin','patches/frame-replay-ending.asm','-o','build/frame-replay-ending.bin'],cwd=ROOT,check=True)
    code=bytearray((ROOT/'build/frame-replay-ending.bin').read_bytes())
    normal,extra,direct=struct.unpack('<3H',code[-6:])
    insert=0xe800
    assert original[0xe7ff:0xe801]==bytes.fromhex('c9c3')
    assert code[0]==0xc3 # preserve staffroll LEAVE/RET fall-through
    gap=(len(code)+15)&~15
    image=bytearray(original)
    assert original[0xe359:0xe35e]==bytes.fromhex('9a880a800e')
    # ReC98 allcast.cpp documents this original landmine: seven real screens
    # but an eight-entry array. The last transition tries pi_load(nullptr).
    # No eighth image is ever displayed; skip that invalid preload only.
    assert image[0xb331:0xb336]==bytes.fromhex('833e144f08')
    image[0xb335]=7
    # Replay-only presentation shortcut. Keep native normal score generation
    # and all staffroll initialization/cleanup; bypass the animation loops.
    for at,expected in [(0xa65d,'e844ff'),(0xa670,'e831ff'),(0xa673,'e8550d')]:
        assert image[at:at+3]==bytes.fromhex(expected)
        image[at:at+3]=b'\x90'*3
    assert image[0xe56a:0xe56d]==bytes.fromhex('83fe64')
    image[0xe56a:0xe56d]=b'\xe9'+struct.pack('<H',(direct-0xe56d)&65535)
    # Native normal staffroll: settled score page and the explicit exit path.
    for at,expected,target in [(0xe7c0,'e88bfb',normal),(0xe75c,'e8effb',normal),(0xd20a,'e862ff',extra)]:
        assert image[at:at+3]==bytes.fromhex(expected),(hex(at),image[at:at+3].hex())
        image[at:at+3]=b'\xe8'+struct.pack('<H',(target-at-3)&65535)
    extra_reloc=insert+code.index(bytes.fromhex('9a880a800e'))+3
    palette_reloc=insert+code.index(bytes.fromhex('9a8a1b0000'))+3
    for at in relocations:
        segment=struct.unpack_from('<H',image,at)[0]
        if segment*16>=insert:struct.pack_into('<H',image,at,segment+gap//16)
    struct.pack_into('<H',code,extra_reloc-insert,0xe80+gap//16)
    image[insert:insert]=code+bytes(gap-len(code))
    relocs=sorted([at+(gap if at>=insert else 0) for at in relocations]+[extra_reloc,palette_reloc])
    header_size=(32+len(relocs)*4+15)&~15
    size=header_size+len(image)
    new_ss=ss+gap//16
    minimum=max(0,(new_ss*16+sp+0x100-((len(image)+15)&~15)+15)//16)
    header=bytearray(header_size)
    struct.pack_into('<14H',header,0,0x5a4d,size%512,(size+511)//512,len(relocs),header_size//16,minimum,0xffff,new_ss,sp,0,0,0,32,0)
    for i,at in enumerate(relocs):struct.pack_into('<2H',header,32+i*4,at%16,at//16)
    return bytes(header+image)
def main():
    nasm=ROOT.parent/'th04-coop-lab/tools/nasm-2.16.03/nasm.exe'
    manifest={'version':'th05-game-input/2','languages':{}}
    disk=Fat12(gzip.decompress((ROOT/'baseline/5-jp.hdi.gz').read_bytes()))
    ending=build_ending(disk.read(disk.files()['KAIKI/MAINE.EXE']),nasm)
    (ROOT/'web/frame-replay-ending.exe.gz').write_bytes(gzip.compress(ending,mtime=0))
    manifest['ending']={'url':'frame-replay-ending.exe.gz','sha256':hashlib.sha256(ending).hexdigest(),'size':len(ending),'sourceMd5':'2c539d61f4dd8c864df0b7885181b8db'}
    for language in ('cn','jp'):
      variants={}
      for profile,sequence in [('',None),('good',255),('bad',254),('extra',253)]:
        args=[str(nasm),'-f','bin','patches/frame-replay.asm','-o','build/frame-replay.bin']
        if sequence:args.append(f'-DREPLAY_TEST_SEQUENCE={sequence}')
        subprocess.run(args,cwd=ROOT,check=True)
        payload=(ROOT/'build/frame-replay.bin').read_bytes()
        statistics,load,frame,leave,dialog_start,dialog_end=struct.unpack('<6H',payload[-12:])
        disk=Fat12(gzip.decompress((ROOT/f'baseline/5-{language}.hdi.gz').read_bytes()))
        assert hashlib.md5(disk.read(disk.files()['KAIKI/MAINE.EXE'])).hexdigest()==manifest['ending']['sourceMd5']
        original=disk.read(disk.files()['KAIKI/MAIN.EXE'])
        exe,patch=build_exe(original,payload,language)
        hsize=struct.unpack_from('<H',exe,8)[0]*16
        exe=bytearray(exe)
        for at,expected,target in [(0xae3b,bytes.fromhex('e8e037'),load),(0xaed7,bytes.fromhex('ff1656c6'),frame),(0xcf1f,bytes.fromhex('e8e015'),statistics)]:
            assert exe[hsize+at:hsize+at+len(expected)]==expected
            exe[hsize+at:hsize+at+len(expected)]=b'\xe8'+struct.pack('<H',(BASE+target-at-3)&65535)+b'\x90'*(len(expected)-3)
        assert exe[hsize+0xcec2:hsize+0xcec5]==bytes.fromhex('558bec')
        exe[hsize+0xcec2:hsize+0xcec5]=b'\xe9'+struct.pack('<H',(BASE+leave-0xcec5)&65535)
        for at,expected,target in [(0x13e58,bytes.fromhex('558bec'),dialog_start),
                                   (0x13eff,bytes.fromhex('baa600a0d64aee'),dialog_end)]:
            assert exe[hsize+at:hsize+at+len(expected)]==expected
            exe[hsize+at:hsize+at+len(expected)]=b'\xe9'+struct.pack('<H',(BASE+target-at-3)&65535)+b'\x90'*(len(expected)-3)
        name=f'frame-replay-{language}'+(f'-test-{profile}' if profile else '')+'.exe.gz'
        (ROOT/'web'/name).write_bytes(gzip.compress(exe,mtime=0))
        variants[profile or 'normal']={'url':name,'sha256':hashlib.sha256(exe).hexdigest(),'size':len(exe),'patch':patch}
      manifest['languages'][language]=variants.pop('normal')
      manifest['languages'][language]['tests']=variants
    # Keep the ordinary payload available for the existing dialogue QA fixture.
    subprocess.run([str(nasm),'-f','bin','patches/frame-replay.asm','-o','build/frame-replay.bin'],cwd=ROOT,check=True)
    (ROOT/'web/frame-replay.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Built separate CN/JP replay input overlays; normal solo disks unchanged.')
if __name__=='__main__':main()
