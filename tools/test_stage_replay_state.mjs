import assert from 'node:assert/strict';
import fs from 'node:fs';
import {captureProbeInitial,restoreProbeInitial,PROBE_DATA_FIELDS,probeCodeFields} from './stage_replay_probe_state.mjs';

const patch=JSON.parse(fs.readFileSync(new URL('../web/patch-cn.json',import.meta.url)));
const layout={code:0,data:65536,resident:131072},heap=new Uint8Array(196608);
for(let n=0;n<heap.length;n++)heap[n]=(n*17+19)%256;
heap.set(new TextEncoder().encode('KSOConfig\0'),layout.resident);
heap[layout.data+0x576e]=2;heap[patch.entry_map.player_count]=2;
heap[layout.resident+0x13]=2;
const initial=captureProbeInitial(heap,layout,patch);
assert.equal(initial.bytes.length,490);
const destination=heap.slice();
for(const [,offset,size]of PROBE_DATA_FIELDS)destination.fill(7,layout.data+offset,layout.data+offset+size);
destination[layout.data+0x576e]=2;
const before=destination.slice();
restoreProbeInitial(initial,destination,layout,patch);
assert.deepEqual(captureProbeInitial(destination,layout,patch),initial);
const allowed=new Set();
for(const [base,fields]of [[layout.data,PROBE_DATA_FIELDS],[layout.code,probeCodeFields(patch)],[layout.resident,[['resident',0,128]]]])
  for(const [,offset,size]of fields)for(let n=0;n<size;n++)allowed.add(base+offset+n);
for(let n=0;n<destination.length;n++)if(!allowed.has(n))assert.equal(destination[n],before[n],'write outside fixed schema');

const hash=bytes=>{let h=2166136261;for(const n of bytes)h=Math.imul(h^n,16777619);return (h>>>0).toString(16).padStart(8,'0');};
function rejected(change,otherLayout=layout,otherPatch=patch){
  const bad=structuredClone(initial);change(bad);
  const saved=destination.slice();
  assert.throws(()=>restoreProbeInitial(bad,destination,otherLayout,otherPatch));
  assert.deepEqual(destination,saved,'failed restore must be atomic');
}
for(const edit of [
  value=>{value.version='old';},value=>{value.diskSha='0'.repeat(64);},
  value=>{value.stage=3;},value=>{value.players=3;},value=>{value.config[1]^=1;},
  value=>{value.bytes.pop();},value=>{value.bytes.push(0);},
  value=>{value.bytes[0]=-1;},value=>{value.bytes[0]=256;},value=>{value.bytes[0]=NaN;},
  value=>{value.bytes[0]^=1;},value=>{value.checksum='00000000';},
  value=>{delete value.bytes[0];value.checksum=hash(value.bytes);},
  value=>{delete value.config[0];},
])rejected(edit);
let offset=0;
for(const [name,,size]of PROBE_DATA_FIELDS){
  if(name==='stageClockAndSettings')rejected(value=>{value.bytes[offset+10]=3;value.checksum=hash(value.bytes);});
  offset+=size;
}
rejected(value=>{value.bytes[value.bytes.length-128]=0;value.checksum=hash(value.bytes);});
rejected(value=>{value.bytes[value.bytes.length-128+0x13]=3;value.checksum=hash(value.bytes);});
rejected(()=>{},{...layout,resident:destination.length-127});
rejected(()=>{},layout,{...patch,entry_map:{...patch.entry_map,personal_stats:65535}});
console.log('PASS stage initialization schema: 490 bytes, resource/config binding, fixed writes and atomic rejection');
