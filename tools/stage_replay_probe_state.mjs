// Experimental stage initialization conditions. This module is routed only by
// test_stage_replay.cjs; no production Worker imports it. It is not a savestate
// and does not define the multiplayer Replay or network format.
export const PROBE_VERSION='th05-stage-probe/2';
export const PROBE_DATA_FIELDS=Object.freeze([
  ['rng',0x418,4],
  ['pointExtends',0x1372,1],['dreamTransition',0x13ce,1],
  ['dreamCount',0x1e02,1],['primaryCollectionStats',0x1e78,12],
  ['primaryPlayerAndScore',0x36d0,80],['performanceAndGraze',0x3f90,24],
  // Original sparks_init resets only the low byte of this word.
  ['sparkCursor',0x41dc,2],['primaryStocks',0x4ad4,4],
  ['stageClockAndSettings',0x5764,20],
].map(Object.freeze));
export function probeCodeFields(patch){
  const e=patch.entry_map,m=patch.mailbox_cs_offset;
  for(const key of ['p3_state','p3_resources','p3_shots','p3_overflow','guest_slot',
    'personal_stats','power_fraction','hit_owner','out_flags','run_config','player_count'])
    if(!Number.isInteger(e?.[key])||e[key]<0||e[key]>=65536)throw Error('Stage probe patch layout invalid');
  if(!Number.isInteger(m)||m<0||m>=65536)throw Error('Stage probe mailbox invalid');
  const fields=[
    ['nativeTicks',m+16,4],['generation',m+26,2],
    ['thirdPlayer',e.p3_state,42],['thirdStocks',e.p3_resources,2],
    ['thirdShots',e.p3_shots,4],['thirdOverflow',e.p3_overflow,2],['guestSlot',e.guest_slot,1],
    ['secondPlayer',m+40,42],['secondStocks',m+82,2],
    ['secondShots',m+84,4],['secondOverflow',m+88,2],
    ['personalStats',e.personal_stats,96],['powerFractions',e.power_fraction,3],
    ['statsReady',e.hit_owner+1,1],['dreamTransitions',e.power_fraction+3,3],
    ['outFlags',e.out_flags,3],
  ];
  if(fields.some(([,offset,size])=>offset<0||offset+size>65536)||e.run_config+12>65536)
    throw Error('Stage probe code span invalid');
  return fields;
}
const residentId=new TextEncoder().encode('KSOConfig\0');
function spans(heap,layout,patch){
  const result=[...PROBE_DATA_FIELDS.map(([name,offset,size])=>[name,layout.data+offset,size]),
    ...probeCodeFields(patch).map(([name,offset,size])=>[name,layout.code+offset,size]),
    ['resident',layout.resident,128]];
  result.push(['configuration',layout.code+patch.entry_map.run_config,12],
    ['playerCount',layout.code+patch.entry_map.player_count,1]);
  if(!(heap instanceof Uint8Array)||result.some(([,at,size])=>!Number.isSafeInteger(at)||at<0||at+size>heap.length))
    throw Error('Stage probe memory bounds invalid');
  if(!residentId.every((byte,i)=>heap[layout.resident+i]===byte))throw Error('Stage probe resident invalid');
  return result;
}
function digest(bytes){let h=2166136261;for(const byte of bytes)h=Math.imul(h^byte,16777619);return (h>>>0).toString(16).padStart(8,'0');}
export function captureProbeInitial(heap,layout,patch){
  const fields=spans(heap,layout,patch),payload=fields.slice(0,-2),e=patch.entry_map;
  const bytes=payload.flatMap(([,at,size])=>Array.from(heap.subarray(at,at+size)));
  return {version:PROBE_VERSION,diskSha:patch.sha256,stage:heap[layout.data+0x576e],
    players:heap[layout.code+e.player_count],config:Array.from(heap.subarray(layout.code+e.run_config,layout.code+e.run_config+12)),
    bytes,checksum:digest(bytes)};
}
export function restoreProbeInitial(initial,heap,layout,patch){
  const fields=spans(heap,layout,patch),payload=fields.slice(0,-2),size=payload.reduce((n,[,,size])=>n+size,0);
  if(initial?.version!==PROBE_VERSION||!/^[a-f0-9]{64}$/.test(initial.diskSha)||initial.diskSha!==patch.sha256||
    !Number.isInteger(initial.stage)||initial.stage<0||initial.stage>6||
    initial.stage!==heap[layout.data+0x576e]||![2,3].includes(initial.players)||
    initial.players!==heap[layout.code+patch.entry_map.player_count]||
    !Array.isArray(initial.config)||initial.config.length!==12||
    !Array.from(initial.config).every((byte,i)=>byte===heap[layout.code+patch.entry_map.run_config+i])||
    !Array.isArray(initial.bytes)||initial.bytes.length!==size||
    !Array.from(initial.bytes).every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255)||digest(initial.bytes)!==initial.checksum)
    throw Error('Stage probe initial conditions invalid');
  let position=0;
  for(const [name,,length]of payload){
    if(name==='resident'&&!residentId.every((byte,i)=>initial.bytes[position+i]===byte))throw Error('Stage probe resident identity mismatch');
    if(name==='resident'&&initial.bytes[position+0x13]!==initial.stage)throw Error('Stage probe resident stage mismatch');
    if(name==='stageClockAndSettings'&&initial.bytes[position+10]!==initial.stage)throw Error('Stage probe stage mismatch');
    position+=length;
  }
  // All checks finish before the first write; serialized offsets are never used.
  position=0;
  for(const [,at,length]of payload){heap.set(initial.bytes.slice(position,position+length),at);position+=length;}
}
