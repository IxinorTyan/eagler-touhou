import assert from 'node:assert/strict';
import {createFrameReplayBridge} from '../web/frame-replay-bridge.js';
function fixture(){
 const heap=new Uint8Array(0x180000),view=new DataView(heap.buffer),patch={signature:'TH05SOLOINPUTv1!',mailbox_cs_offset:0x100};
 const data=0x40000,resident=0x70000,packed=(0x3000<<16)|0x1000;
 heap.set(new TextEncoder().encode(patch.signature),0x20100);view.setUint16(0x20100+20,0x3000,true);
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
assert.equal(r.result.frames,1);assert.deepEqual(r.chunks,[17],'keep the input that triggered clear');
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
