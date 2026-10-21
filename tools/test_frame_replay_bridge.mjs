import assert from 'node:assert/strict';
import {createFrameReplayBridge} from '../web/frame-replay-bridge.js';
function fixture(){
 const heap=new Uint8Array(0x180000),view=new DataView(heap.buffer),patch={signature:'TH05SOLOINPUTv1!',mailbox_cs_offset:0x100};
 const data=0x40000,resident=0x70000,packed=(0x3000<<16)|0x1000;
 heap.set(new TextEncoder().encode(patch.signature),0x20100);heap[0x20100+22]=1;view.setUint16(0x20100+20,0x3000,true);
 view.setUint16(data+0x41fe,0x6000,true);heap.set(new TextEncoder().encode('KSOConfig'),resident);heap[resident+13]=3;
 view.setUint16(data+0x3064,17,true);
 return {mod:{HEAPU8:heap},view,patch,data,resident,packed};
}
function create(f,config){
 const output={chunks:[],result:null};
 output.bridge=createFrameReplayBridge({...f,config,onRun:()=>{},onChunk:c=>output.chunks.push(...c),onEnd:r=>output.result=r});
 return output;
}
const record=fixture(),r=create(record,{mode:'record'});
r.bridge.signal(0x7ff0,record.packed);r.bridge.signal(0x7ff1,record.packed);
record.view.setInt16(record.data+0x36d2,16,true);record.mod.HEAPU8[record.resident+26]=255;
r.bridge.signal(0x7ff2,record.packed);
assert.equal(r.result,null,'natural clear must not seal the file at MAIN exit');
assert.equal(r.bridge.status.phase,'ending');assert.deepEqual(r.chunks,[]);
r.bridge.finish();assert.equal(r.result,null,'manual prefix finish is disabled while MAINE owns game memory');
record.view.setUint32(record.resident+60,105,true);r.bridge.signal(0x7ff6,record.packed);
record.mod.HEAPU8.fill(255,record.data,record.data+0x10000);
r.bridge.signal(0x7ff5,0x12345678);
assert.equal(r.result.frames,1);assert.deepEqual(r.chunks,[17,0,0,0,0,0],'keep the input that triggered clear');
assert.equal(r.result.ending.slowFrames,105);assert.equal(r.result.state.x,1);
function playback(changeResident=false){
 const f=fixture(),p=create(f,{mode:'playback',header:r.result,inputs:Uint8Array.from(r.chunks)});
 p.bridge.signal(0x7ff0,f.packed);p.bridge.signal(0x7ff1,f.packed);
 f.view.setInt16(f.data+0x36d2,16,true);f.mod.HEAPU8[f.resident+26]=255;p.bridge.signal(0x7ff2,f.packed);
 f.view.setUint32(f.resident+60,42,true);p.bridge.signal(0x7ff6,f.packed);
 assert.equal(f.view.getUint32(f.resident+60,true),105,'only the recorded slowdown result is restored after battle');
 assert.equal(f.view.getInt16(f.data+0x36d2,true),16,'no player state correction');
 f.mod.HEAPU8.fill(255,f.data,f.data+0x10000);
 if(changeResident)f.mod.HEAPU8[f.resident+27]++;
 p.bridge.signal(0x7ff5,0);
 return p.result;
}
assert.equal(playback().matches,true,'ending survives MAIN memory reuse');
assert.equal(playback(true).matches,false,'different life/miss statistics must not be hidden');
const early=fixture(),e=create(early,{mode:'playback',header:r.result,inputs:Uint8Array.from(r.chunks)});
e.bridge.signal(0x7ff0,early.packed);e.bridge.signal(0x7ff1,early.packed);
assert.throws(()=>e.bridge.signal(0x7ff1,early.packed),/尚未触发通关/,'input exhaustion must not masquerade as a clear');
console.log('PASS: clear input commit, MAIN→MAINE lifetime, score endpoint, slowdown metadata and mismatch rejection');
const cheated=fixture(),c=create(cheated,{mode:'record'});
c.bridge.signal(0x7ff0,cheated.packed);c.bridge.signal(0x7ff1,cheated.packed);
c.bridge.setCheat(true);c.bridge.signal(0x7ff1,cheated.packed);
assert.equal(c.bridge.status.bytes,0);assert.equal(cheated.mod.HEAPU8[cheated.data+0x36d0+30],2);
c.bridge.setCheat(false);c.bridge.finish();assert.equal(c.result,null,'turning cheat off cannot re-enable this run');
c.bridge.signal(0x7ff2,cheated.packed);assert.equal(c.result.discarded,true);assert.deepEqual(c.chunks,[]);
c.bridge.signal(0x7ff0,cheated.packed);assert.equal(c.bridge.status.tainted,false,'fresh native MAIN resets the per-run taint');
c.bridge.signal(0x7ff1,cheated.packed);c.bridge.signal(0x7ff1,cheated.packed);c.bridge.finish();
assert(!c.result.discarded);assert.equal(c.chunks.length,6,'the clean next run has a fresh input buffer');
const blocked=create(fixture(),{mode:'playback',header:r.result,inputs:Uint8Array.from(r.chunks)});
assert.throws(()=>blocked.bridge.setCheat(true),/不能启用作弊/);
console.log('PASS: cheat destroys recording, native invulnerability, sticky run taint, clean next run and playback cheat rejection');

const storage=fixture(),s=create(storage,{mode:'record'});
s.bridge.signal(0x7ff0,storage.packed);s.bridge.signal(0x7ff1,storage.packed);
s.bridge.stopRecording();
for(let i=0;i<140;i++)s.bridge.signal(0x7ff1,storage.packed);
assert.equal(s.bridge.status.recordingStopped,true);assert.equal(s.bridge.status.tainted,false);
assert.equal(s.bridge.status.bytes,0);assert.equal(storage.mod.HEAPU8[storage.data+0x36d0+30],0,'storage failure must not grant invulnerability');
assert.deepEqual(s.chunks,[]);s.bridge.finish();assert.equal(s.result,null);
s.bridge.signal(0x7ff2,storage.packed);assert.equal(s.result.reason,'storage');
s.bridge.signal(0x7ff0,storage.packed);assert.equal(s.bridge.status.recordingStopped,false);
s.bridge.signal(0x7ff1,storage.packed);s.bridge.signal(0x7ff1,storage.packed);s.bridge.finish();
assert(!s.result.discarded);assert.equal(s.chunks.length,6);
blocked.bridge.stopRecording();assert.equal(blocked.bridge.status.recordingStopped,false,'optional recording failure cannot disable playback verification');
console.log('PASS: storage failure drops recording without cheat, boundary wait or input changes; next native run records again');

const dragged=fixture(),d=create(dragged,{mode:'record'}),touchAt=0x20100+28;
d.bridge.signal(0x7ff0,dragged.packed);
d.bridge.touchInput({generation:0,touch:{active:true,unlimited:false,x:-1240,y:777}});
assert.equal(dragged.view.getUint16(touchAt,true),0,'asynchronous touch messages do not write native input before the boundary');
d.bridge.signal(0x7ff1,dragged.packed);d.bridge.signal(0x7ff1,dragged.packed);d.bridge.finish();
assert.equal(d.chunks.length,6);assert.equal(d.chunks[1],1);
const replayed=fixture(),dr=create(replayed,{mode:'playback',header:d.result,inputs:Uint8Array.from(d.chunks)});
dr.bridge.signal(0x7ff0,replayed.packed);dr.bridge.signal(0x7ff1,replayed.packed);
assert.equal(replayed.view.getUint16(touchAt,true),1);assert.equal(replayed.view.getInt16(touchAt+2,true),-1240);assert.equal(replayed.view.getInt16(touchAt+4,true),777);
dr.bridge.signal(0x7ff1,replayed.packed);assert(dr.result.matches);
const unlimitedMove=fixture(),u=create(unlimitedMove,{mode:'record'});
u.bridge.signal(0x7ff0,unlimitedMove.packed);u.bridge.touchInput({generation:0,touch:{active:true,unlimited:true,x:100,y:100}});u.bridge.signal(0x7ff1,unlimitedMove.packed);
assert(u.bridge.status.tainted);assert.equal(unlimitedMove.mod.HEAPU8[unlimitedMove.data+0x36d0+30],0,'unlimited movement does not accidentally turn on invulnerability');
u.bridge.setCheat({invincible:false,unlimited:false});assert(u.bridge.status.tainted);
u.bridge.signal(0x7ff2,unlimitedMove.packed);unlimitedMove.view.setUint16(touchAt,0,true);u.bridge.signal(0x7ff0,unlimitedMove.packed);assert(!u.bridge.status.tainted);
console.log('PASS limited touch mailbox round trip, synchronous unlimited rejection, separate invulnerability and next-run recovery');
