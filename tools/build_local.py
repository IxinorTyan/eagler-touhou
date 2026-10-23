"""Build only the TH05 local prototype. Never alters the source disks."""
from pathlib import Path
import gzip
import hashlib
import json
import struct
import subprocess
from disk_image import Fat12
from native_performance import apply_performance
from build_translation import Translation

ROOT = Path(__file__).resolve().parents[1]
BASE = 0xAE10
INSERT = 0x14AB0
ENTRY_NAMES = ('init_hook update_hook render_hook invalidate_hook mailbox swap_player run_stage '
               'retire_hook bomb_start bomb_render bomb_x bomb_y aim_hook atan_pointer '
               'hit_bullet hit_square8 hit_square7 hit_enemy hit_pellet hit_laser '
               'hit_cheeto hit_firewave hit_boss publish rescue_tick ghosts_render '
               'out_flags rescue_progress invincible stats p2_overflow hit_counts target_counts '
               'restart_players p2_check hit_wall_left hit_wall_right aim_x_one aim_x_two hud_hook laser_test '
               'run_config configure_players assets_load bft_pointer tiny_pointer shot_tag shot_draw hit_draw hit_tag '
               'damage_begin damage_add damage_bomb bomb_character damage_finish shot_owners p2_character '
               'item_hittest item_award_leave item_team_1up item_aim item_sound_pointer item_pickups item_team_bomb '
               'touch_state touch_move player_count guest_slot p3_input p3_focus p3_xy p3_state p3_resources p3_shots p3_overflow '
               'p3_character p3_patterns rescue_target bind_player guest_bank '
               'guest_patterns guest_cdg p3_bb p3_bomb_func assets_ready heap_config '
               'personal_stats personal_bonus power_fraction hit_weights hit_owner stats_frame stats_restart stats_stage_reset '
               'stats_damage_award stats_active_add stats_kill_add stats_kill_550 stats_kill_100 '
               'stats_clear_big stats_clear_small stats_clear_add stats_world_add stats_stage_bonus stats_allclear_bonus '
               'stats_damage_second_begin stats_damage_second_add power_pickup_bonus boss_main_damage boss_other_damage boss_mid_damage boss_balance '
               'stats_world_dream_grow stats_world_dream_drop native_pause_hook native_pause_state '
               'art_variants select_art_variants recolor_guest_player recolor_guest_shots '
               'hud_scroll_capture hud_scroll_line afterimage_put afterimage_context offline_apply offline_mask bomb_background_load '
               'shots_allocate shots_begin shots_end shots_next shots_compare shots_clear item_team_life').split()
SHOT_COUNT=288
SHOT_EXTRA_BASE=0xc740
SHOT_EXTRA_END=SHOT_EXTRA_BASE+(SHOT_COUNT-64)*18
SHOT_ALIVE_BASE=SHOT_EXTRA_END
SHOT_STACK_BASE=SHOT_ALIVE_BASE+SHOT_COUNT*6
SHOT_BSS_SIZE=SHOT_STACK_BASE-0xc740
COMBINED_BUDGET={2:315328,3:393904}
MAIN_MD5 = {'jp': '952585e02435c3b3b111975a78b05983', 'cn': '553eee5ff79429f45284913870380549'}


def near_sites(image, target):
    return [at for at in range(BASE, INSERT - 2)
            if image[at] == 0xe8 and
            ((at + 3 - BASE + struct.unpack_from('<h', image, at + 1)[0]) & 0xffff) == target - BASE]


def build(lang):
    original_disk = gzip.decompress((ROOT / f'baseline/5-{lang}.hdi.gz').read_bytes())
    disk = Fat12(original_disk)
    files = disk.files()
    exe = disk.read(files['KAIKI/MAIN.EXE'])
    assert hashlib.md5(exe).hexdigest() == MAIN_MD5[lang], 'Unsupported MAIN.EXE version'
    header_size = struct.unpack_from('<H', exe, 8)[0] * 16
    header, original = bytearray(exe[:header_size]), exe[header_size:]
    image = bytearray(original)
    if lang == 'cn':
        image[:] = Translation().main_strings(exe)[header_size:]
    assert original[0xae1e:0xae2a] == bytes.fromhex('558beca17a263b066a5772f7'), 'Original VSync wait changed'
    payload = bytearray((ROOT / 'build/local.bin').read_bytes())
    assert payload.count(b'PS05') == 1
    support_at = payload.index(b'PS05')
    support = payload[support_at+4:]
    del payload[support_at:]
    assert len(support) <= 0xd1a2-0xd036
    entries = struct.unpack_from(f'<{len(ENTRY_NAMES)}H', payload, 16)
    entry_map = dict(zip(ENTRY_NAMES, entries))
    body_layer_seat = struct.unpack_from('<H',payload,payload.index(b'BDY1')+4)[0]
    gap = (len(payload) + 15) & ~15
    assert INSERT - BASE + gap < 65536
    heaps={n:((budget-gap-SHOT_BSS_SIZE)//16)*16 for n,budget in COMBINED_BUDGET.items()}
    assert heaps[2]>=291200 and heaps[3]>=360000, 'CN stage-four BB0 needs the original 2P sprite heap; re-audit before growing patch/BSS'
    assert all(gap+SHOT_BSS_SIZE+heaps[n]<=budget for n,budget in COMBINED_BUDGET.items())
    # This near function begins BEFORE the shared segment but ends inside it.
    # Its original copy must remain at the original near address after insertion.
    assert original[INSERT - 6:INSERT + 8] == bytes.fromhex('57b810ac8ec0bfb436e84abb5fc3')
    payload[:8] = original[INSERT:INSERT + 8]
    table, count = struct.unpack_from('<H', header, 24)[0], struct.unpack_from('<H', header, 6)[0]
    relocations = []
    for i in range(count):
        off, seg = struct.unpack_from('<HH', header, table + i * 4)
        location = seg * 16 + off
        if 0xd036 <= location < 0xd1a2:
            continue  # removed solo HUD tails now hold near-only support code
        target = struct.unpack_from('<H', image, location)[0]
        if target * 16 >= INSERT:
            struct.pack_into('<H', image, location, target + gap // 16)
        moved = location + (gap if location >= INSERT else 0)
        relocations.append(moved)
    for field in (14, 22):
        seg = struct.unpack_from('<H', header, field)[0]
        if seg * 16 >= INSERT:
            struct.pack_into('<H', header, field, seg + gap // 16)
    # Preserve the CRT's complete original stack. Add shot BSS before SS,
    # extend the loader allocation and let startup zero the new region too.
    assert struct.unpack_from('<H',exe,14)[0]==0x2d11
    assert original[0xb8:0xbb]==bytes.fromhex('b934c7')
    original_stack=struct.unpack_from('<H',original,0x209d0+0x22e2)[0]
    assert original_stack==4096 and SHOT_STACK_BASE+original_stack+16<65536, 'Preserve the complete aligned DOS stack within DS'
    assert SHOT_BSS_SIZE%16==0
    struct.pack_into('<H',header,10,struct.unpack_from('<H',header,10)[0]+SHOT_BSS_SIZE//16)
    struct.pack_into('<H',header,14,struct.unpack_from('<H',header,14)[0]+SHOT_BSS_SIZE//16)
    struct.pack_into('<H',image,0xb9,SHOT_STACK_BASE)
    specs = [(0xb309, 0xb55a, entries[0], 'stage_init'),
             (0xaecb, 0xb637, entry_map['native_pause_hook'], 'native_pause'),
             (0xaef9, 0xcc3d, entries[1], 'player_update'),
             (0xaf3b, 0xcd56, entries[2], 'player_render'),
             (0xae8c, 0xaea6, entries[6], 'stage_lifecycle'),
             (0xcc35, 0xd85c, entry_map['retire_hook'], 'last_life')]
    sites = near_sites(original, 0xc9ba)
    assert len(sites) == 1, sites
    specs.append((sites[0], 0xc9ba, entries[3], 'player_invalidate'))
    laser_sites=near_sites(original,0xd6c6)
    assert len(laser_sites)==2,laser_sites
    specs.extend((at,0xd6c6,entry_map['laser_test'],'laser_test') for at in laser_sites)
    hooks = []
    for at, target, entry, name in specs:
        expected = b'\xe8' + struct.pack('<H', (target-at-3) & 0xffff)
        assert original[at:at+3] == expected, name
        image[at:at+3] = b'\xe8' + struct.pack('<H', (BASE+entry-at-3) & 0xffff)
        hooks.append({'name': name, 'image_offset': at, 'expected': expected.hex(), 'entry': entry})
    def hook(at, expected, name, far=False):
        expected = bytes.fromhex(expected)
        assert original[at:at+len(expected)] == expected, (hex(at), name, original[at:at+len(expected)].hex())
        entry = entry_map[name]
        # Displaced far calls may have MZ relocation operands inside the hook.
        # Remove those stale entries before installing the new call, otherwise
        # the DOS loader would relocate padding into executable garbage.
        moved_start=at+(gap if at>=INSERT else 0)
        relocations[:] = [loc for loc in relocations
                          if not moved_start <= loc < moved_start+len(expected)]
        if far:
            replacement = b'\x9a' + struct.pack('<HH',entry,BASE//16)
            loc = at+3+(gap if at >= INSERT else 0)
            if loc not in relocations:
                relocations.append(loc)
        else:
            replacement = b'\xe8'+struct.pack('<H',(BASE+entry-at-3)&65535)
        assert len(expected) >= len(replacement)
        image[at:at+len(expected)] = replacement + b'\x90'*(len(expected)-len(replacement))
        hooks.append({'name':name,'image_offset':at,'expected':expected.hex(),'entry':entry})
    hook(0xb3cc,'e8c009','assets_load')
    hook(0x13efc,'e80801','bomb_background_load')
    hook(0xcdc3,'9ae02f0000','afterimage_put',far=True)
    call_offset = payload.index(bytes.fromhex('9ae02f0000'), entry_map['afterimage_put']-0x9ca0)
    relocations.append(INSERT+call_offset+3)
    hook(0xae42,'c70624081847','heap_config')
    hook(0xccda,'e8f5fd','touch_move')
    before=original[0xe38c:0xe3c3]
    assert before.hex()=='33c08b1e004281fb0ebf732a83c312803f0075f2c707010066a1d2366689470266c7470a000040ffc7470e14008bc383c312891e0042c3'
    entry=entry_map['shots_allocate']
    image[0xe38c:0xe3c3]=(b'\xe9'+struct.pack('<H',(BASE+entry-0xe38c-3)&65535)).ljust(len(before),b'\x90')
    hooks.append({'name':'shots_allocate','image_offset':0xe38c,'expected':before.hex(),'entry':entry,'tail_jump':True})
    for at in (0x133ad,0x13504):hook(at,'83c612','shots_next')
    for at in (0x133b0,0x13507):
        assert original[at:at+4]==bytes.fromhex('837efe40')
        image[at:at+4]=b'\x90'*4 # flags now come from shots_next
    # A nonempty physical pool always visits slot zero first; later iterations
    # use shots_next's flags at the original conditional jump.
    for at,expected in ((0x1339a,'eb14'),(0x133f4,'e91001')):
        raw=bytes.fromhex(expected);assert original[at:at+len(raw)]==raw
        image[at:at+len(raw)]=b'\x90'*len(raw)
    hook(0x12b39,'688eba682001e820a4','shots_clear')
    for at in (0x133ed,0x13582,0x136b4,0x13843):
        assert original[at:at+2]==struct.pack('<H',0xc4c8)
        struct.pack_into('<H',image,at,SHOT_ALIVE_BASE)
    hook(0x135bd,'e8bc8a','shot_draw')
    hook(0x135fe,'e87b8a','hit_draw')
    hook(0x13645,'c60401','hit_tag')
    hook(0x136ad,'33f6c646f500','damage_begin')
    # Original hit divisor used one byte in a two-byte local. More than
    # 255 simultaneous hits must retain 1/n attenuation without division by 0.
    for at in (0x136d2,0x13861):
        assert original[at:at+3]==bytes.fromhex('fe46f5')
        image[at:at+3]=bytes.fromhex('ff46f4')
    for at in (0x136dd,0x1386c):
        assert original[at:at+5]==bytes.fromhex('8a56f5b600')
        image[at:at+5]=bytes.fromhex('8b56f49090')
    hook(0x136ee,'03f0fe064ec6','damage_add')
    hook(0x13724,'803e064200','damage_bomb')
    hook(0x13753,'803e735701','bomb_character')
    hook(0x1378d,original[0x1378d:0x13803].hex(),'damage_finish')
    hook(0x1383c,'33ffc646f500','stats_damage_second_begin')
    hook(0x1387d,'03f8fe064ec6','stats_damage_second_add')
    hook(0xaf6a,'e80c16','stats_frame')
    score_hooks = {
        0x13807:('6601061237','stats_damage_award'),
        0x138d9:('6601061237','stats_damage_award'),
        0x16d02:('6601061237','stats_kill_add'),
        0x1851e:('668106123726020000','stats_kill_550'),
        0x1c146:('668306123764','stats_clear_big'),
        0x1c14e:('66830612370a','stats_clear_small'),
        0x1c317:('6601061237','stats_active_add'),
        0x1c416:('6601061237','stats_clear_add'),
        0x1c55f:('6601061237','stats_world_add'),
        0x1c5ca:('6601061237','stats_world_add'),
        0x1c9c3:('6601061237','stats_stage_bonus'),
        0x1cc06:('6601061237','stats_allclear_bonus'),
        0x1d017:('6601061237','stats_active_add'),
        0x1e194:('668306123764','stats_kill_100'),
    }
    score_signatures=('6601061237','6681061237','6683061237')
    found={at for at in range(BASE,len(original))
           if any(original.startswith(bytes.fromhex(sig),at) for sig in score_signatures)}
    assert found==set(score_hooks), ('unaudited native score award',sorted(found^set(score_hooks)))
    for at,(expected,name) in score_hooks.items(): hook(at,expected,name,True)
    hook(0x16e13,'803ef636807309fe06f6369abd23e10a','stats_world_dream_grow',True)
    hook(0x1d084,'803ef636017618803ef636807311fe0ef636','stats_world_dream_drop',True)
    hook(0x1ce08,'8a450eb4008bd8','power_pickup_bonus',True)
    # Keep the native cumulative 100-point-item check, performance raise,
    # counter, popup and sound. Only replace the personal stock award.
    assert original[0x1cf13:0x1cf16]==bytes.fromhex('e896fe')
    hook(0x1cdcb,'803ed44a637327fe06d44a','item_team_life',True)
    for at,hp,name in [(0x1fae3,0x5ac6,'boss_main_damage'),(0x17848,0x5ade,'boss_mid_damage')]+[
        (at,0x5ab2,'boss_other_damage') for at in (0x15c18,0x15e6f,0x15ef7,0x162e4,0x166a8,0x169bb,0x1bdd0)]:
        hook(at,(bytes.fromhex('b4002906')+struct.pack('<H',hp)).hex(),name,True)
    for pointer in ('bft_pointer','tiny_pointer'):
        relocations.append(BASE+entry_map[pointer]+2)
    hook(0xfaa2,'c606064201','bomb_start')
    hook(0xaf29,'ff160842','bomb_render')
    hook(0xaf66,'ff16c04a','hud_hook')
    hook(0x1ee5,'8b5e068b16c803','hud_scroll_capture',True)
    # Replace only per-item selection / award binding; leave original item
    # movement, point accounting, animation and removal at once per frame.
    item_hit_bytes = '803ef4360075308b1ed23681c3800129c381fb000377208b1ed43681c3800129d381fb60027710'
    hook(0x1d14d,item_hit_bytes,'item_hittest',True)
    # CF=0 goes to the native not-collected acceleration branch.
    image[0x1d152:0x1d156] = b'\x0f\x83'+struct.pack('<H',0x1d184-0x1d156)
    hook(0x1d178,'6a0b9a3202ab14','item_award_leave',True)
    hook(0x1cfd2,'fe06d44a9a2522e10a','item_team_1up',True)
    hook(0x1cfbd,'fe06d54abe6400','item_team_bomb',True)
    hook(0x1d0de,'a1d4362b440450a1d2362b4402509a3a1f0000','item_aim',True)
    sound_location=BASE+entry_map['item_sound_pointer']+2
    struct.pack_into('<H',payload,entry_map['item_sound_pointer']-(INSERT-BASE)+2,0x14ab+gap//16)
    relocations.append(sound_location)
    # Retire display-only single-player stock and Power routines. The
    # Power-to-shot-level calculation E3E2 remains executable and unchanged.
    for at in (0xd035,0xd0e9,0xd255):
        assert original[at:at+3] == bytes.fromhex('558bec')
        image[at]=0xcb
    # Skip character-specific labels; retain score and all shared counters.
    image[0xd036:0xd036+len(support)] = support
    assert original[0xd34d:0xd350] == bytes.fromhex('a07357')
    image[0xd34d:0xd350]=b'\xe9'+struct.pack('<H',0xd3c6-0xd350)
    # Move BOTH the visible boss gauge and its empty/clear paths.
    for at,old,new in ((0xd2cb,8,21),(0xd2dc,9,22),(0xd2fa,8,21),(0xd30d,9,22)):
        assert original[at]==old,(hex(at),original[at])
        image[at]=new
    hook(0x13777,'a1d236','bomb_x')
    hook(0x13782,'a1d436','bomb_y')
    hook(0x11c0b,'a1d436bb1000','hit_wall_left')
    hook(0x11c4e,'a1d436bb1000','hit_wall_right')
    for at, name in [(0x1c2a9,'hit_bullet'),(0x184a5,'hit_square8'),(0x1a983,'hit_square8'),
                     (0x1ab30,'hit_square8'),(0x1ee5b,'hit_square7'),(0x1fd59,'hit_boss')]:
        hook(at,'2b06d2362b16d436',name,True)
    for at in (0x16c37,0x1e12e):
        hook(at,'8b44022b06d236','hit_enemy',True)
    hook(0x1740b,'2b06d236054000','hit_pellet',True)
    hook(0x1a90e,'8b41022b06d236','hit_cheeto',True)
    hook(0x1e6ef,'a1d2362b06f6b3','hit_firewave',True)
    hook(0x1a0ee,'a1d236a39a19','aim_x_one',True)
    hook(0x1bac1,'a1d236a3a45a','aim_x_two',True)
    aim_sites=[]
    for at in range(0x15270,0x1fd70):
        if original[at:at+5] != bytes.fromhex('9a3a1f0000'):
            continue
        prior=original[at-22:at]
        if bytes.fromhex('a1d236') in prior and bytes.fromhex('a1d436') in prior and at != 0x1d0ec:
            aim_sites.append(at)
            hook(at,'9a3a1f0000','aim_hook',True)
    assert aim_sites == [0x171dd,0x17b99,0x17bf5,0x1bf42,0x1e7ca],aim_sites
    relocations.append(BASE+entry_map['atan_pointer']+2)
    performance_hooks = apply_performance(image, payload, BASE)
    image[INSERT:INSERT] = payload + bytes(gap-len(payload))
    # New far calls require more relocation entries than the old header has room for.
    new_header_size = max(header_size,(table+4*len(relocations)+15)&~15)
    header.extend(bytes(new_header_size-len(header)))
    struct.pack_into('<H',header,6,len(relocations))
    struct.pack_into('<H',header,8,new_header_size//16)
    for i,location in enumerate(relocations):
        struct.pack_into('<HH',header,table+i*4,location%16,location//16)
    size = len(header) + len(image)
    struct.pack_into('<HH', header, 2, size % 512, (size + 511) // 512)
    patched = bytes(header + image)
    disk.replace(files['KAIKI/MAIN.EXE'], patched)
    script = b'@ECHO OFF\r\nPATH A:\\DOS;A:\\\r\nSET TEMP=A:\\DOS\r\nSET DOSDIR=A:\\DOS\r\nA:\r\nCD \\KAIKI\r\nCALL GAME.BAT\r\n'
    disk.replace(files['AUTOEXEC.BAT'], script)
    launch_entry=disk.add_root('COOP.COM',(ROOT/'build/COOP.COM').read_bytes())
    game=disk.read(files['KAIKI/GAME.BAT']).replace(b'\r\nop\r\n',b'\r\nA:\\COOP.COM\r\nif errorlevel 1 goto fin\r\nmain\r\n')
    disk.replace(files['KAIKI/GAME.BAT'],game)
    translation_files = Translation().resources(disk) if lang == 'cn' else []
    defaults=[1,1,0,3,3,1,3,3,2,3,3,2]
    launcher=disk.read(launch_entry)
    launch_at=launcher.index(b'TH05WEBSTARTv1!')+len(b'TH05WEBSTARTv1!')
    config_targets=[disk.file_offsets(launch_entry,launch_at,12),disk.file_offsets(files['KAIKI/MAIN.EXE'],new_header_size+BASE+entry_map['run_config'],12)]
    assert all(bytes(disk.data[i] for i in offsets)==bytes(defaults) for offsets in config_targets)
    # Whole-file audit: precisely MAIN + boot routing, all other files unchanged.
    old = Fat12(original_disk)
    changed = [name for name, entry in disk.files().items()
               if name not in old.files() or disk.read(entry) != old.read(old.files()[name])]
    assert 'KAIKI/MAIN.EXE' in changed and set(changed) <= {'AUTOEXEC.BAT', 'KAIKI/MAIN.EXE','KAIKI/GAME.BAT','COOP.COM', *translation_files}, changed
    data = bytes(disk.data)
    (ROOT / f'web/th05-local-{lang}.hdi.gz').write_bytes(gzip.compress(data, mtime=0))
    (ROOT / f'build/MAIN-{lang}.EXE').write_bytes(patched)
    # Original initialized data segment from startup relocation (209Dh).
    meta = {'language': lang, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data),
            'source_main_md5': MAIN_MD5[lang], 'insert_offset': INSERT, 'insert_size': gap,
            'payload_bytes': len(payload), 'heap_bytes': heaps[3],
            'heap_by_players':{str(n):size for n,size in heaps.items()}, 'code_segment': BASE // 16,
            'shot_pool':{'count':SHOT_COUNT,'stride':18,'ranges':[{'base':0xba8e,'count':64},{'base':SHOT_EXTRA_BASE,'count':SHOT_COUNT-64}],
                         'alive_base':SHOT_ALIVE_BASE,'alive_stride':6,'bss_bytes':SHOT_BSS_SIZE,'stack_base':SHOT_STACK_BASE,
                         'combined_budget':{str(n):size for n,size in COMBINED_BUDGET.items()},'rule':'complete native volleys; one shared allocation scan per world update'},
            'bomb_background':'one shared CDG loaded for the bound caster; dialog exit reloads P1; original EMS portraits preserved',
            'data_segment': 0x209d + gap // 16,
            'mailbox_cs_offset': entries[4], 'swap_cs_offset': entries[5],
            'native_pause_cs_offset': entry_map['native_pause_state'],
            'entries': list(entries), 'entry_map':entry_map, 'hooks': hooks,
            'body_layer_cs_offset':body_layer_seat,
            'performance_hooks': performance_hooks, 'changed_files': changed,
            'mailbox_offsets':{name:entry_map[name]-entries[4] for name in
                ('out_flags','rescue_progress','invincible','stats','p2_overflow','hit_counts','target_counts','p3_input','p3_focus','p3_xy','p3_state','p3_resources','p3_shots','p3_overflow','player_count','rescue_target')},
            'launch_config':{'defaults':defaults,'targets':config_targets},
            'touch': {'stride':8,'players':3,'native_movement_hook':0xccda},
            'stage': 'local-independent-characters',
            'afterimageArt': json.loads((ROOT/'web/assets/yuuka-afterimages.json').read_text()),
            'player_art': {'source': 'ghost-preview/th05-four-player-colors',
                'rule': 'same-character occurrence order; first original, second alternate 1, third alternate 2',
                'variants_cs_offset': entry_map['art_variants'], 'ghost_sprites': 12,
                'hud_shot_icons': 'same native main-shot mask and exact reviewed RGB as gameplay',
                'projectiles': 'immutable native banks; character + occurrence + source frame RGB at provenance-aware scanout',
                'palette': 'shared native 16 colors; costume hue ramps, original mounts, unchanged stage palette'},
            'personal_stats':{'cs_offset':entry_map['personal_stats'],'stride':32,
                'score':0,'high_score':4,'stage_point':8,'extend_point':10,'dream':12,'dream_count':13,
                'graze':14,'total_items':16,'total_point':18,'max_point':20,'point_extends':22,'score_extends':23,
                'misses':24,'bombs':26,'stage_miss_start':28,'stage_bomb_start':30,'bonus_cs_offset':entry_map['personal_bonus'],
                'extends':[],'point_extend_interval':100,'score_cap':99999999},
            'score_scope':'team','extend_award':'team-1up',
            'extend_rule':{'counter':'shared cumulative point items','interval':100,'trigger':'native point pickup','score_extends':False},
            'balance':{'score':{'2':1,'3':1},'boss_hp':{'2':1.5,'3':2.2},
                       'power':{'2':1.5,'3':2},'power_cap':128,'boss_method':'final damage with per-phase remainder'},
            'items': {'player_count':3,'pickup_counts':entry_map['item_pickups'],
                      'owner_priority':'first eligible canonical seat, one award per item',
                      'power':'collector; at full Power, small/large P supports lowest living teammate, nearest item then seat',
                      'power_support':{'enabled':True,'kinds':[0,3],'score':'team','overlay':[0xd036,0xd1a2]},
                      'bomb':'living seats only; retired teammates excluded; 99 cap',
                      'one_up':'all seats; retired teammate revives; 100 total lives cap',
                      'point_dream_score':'shared team counters','hud_power_pattern':36},
            'limitations': ['one original Bomb effect at a time; stocks independent']}
    (ROOT / f'web/patch-{lang}.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print(lang, 'payload', len(payload), 'insert', gap, 'hooks', hooks)


def main():
    from runpy import run_path
    run_path(str(ROOT.parent/'tools/native_boss_hud_build_guard.py'))['protect'](ROOT/'web')
    from build_player_colors import build as build_player_colors
    build_player_colors()
    from build_afterimage_art import build as build_afterimage_art
    build_afterimage_art()
    from build_hud_shots import build as build_hud_shots
    build_hud_shots()
    from build_ghosts import build as build_ghosts
    build_ghosts()
    source=Fat12(gzip.decompress((ROOT/'baseline/5-jp.hdi.gz').read_bytes()))
    zun=source.read(source.files()['KAIKI/ZUN.COM'])
    # The original resident installs the 16x16 score gaiji at this table.
    first=0x3941
    assert zun[first:first+4]==bytes.fromhex('01e003f0')
    digits=[list(zun[first+n*32:first+(n+1)*32]) for n in range(10)]
    (ROOT/'web/hud-digits.js').write_text('// Generated from TH05 ZUN.COM score gaiji.\nexport const hudDigits='+json.dumps(digits,separators=(',',':'))+';\n',encoding='utf-8')
    nasm = ROOT.parent / 'th04-coop-lab/tools/nasm-2.16.03/nasm.exe'
    subprocess.run([str(nasm), '-f', 'bin', 'patches/local.asm', '-o', 'build/local.bin',
                    '-l', 'build/local.lst'], cwd=ROOT, check=True)
    subprocess.run([str(nasm),'-f','bin','patches/launch.asm','-o','build/COOP.COM'],cwd=ROOT,check=True)
    for lang in ('jp', 'cn'):
        build(lang)


if __name__ == '__main__':
    main()
