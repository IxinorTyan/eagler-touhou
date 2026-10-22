import assert from 'node:assert/strict';
import {ConfirmedHistory,HISTORY_VERSION,packHistoryRows} from '../web/netplay/confirmed-history.js';
import {packTouch,MAX_INPUT} from '../web/touch-input.js';
import {GameQueue} from '../web/netplay/protocol.js';
const header={version:HISTORY_VERSION,protocol:'th05-netplay/9',language:'cn',players:3,
  config:{rank:1,players:Array.from({length:3},(_,character)=>({character,spares:3,bombs:3}))},
  identity:'a'.repeat(64),coreSha:'b'.repeat(64),diskSha:'c'.repeat(64),guestSha:'d'.repeat(64),checksum:'12345678'};
const rows=Array.from({length:125},(_,frame)=>({pair:[packTouch(32,{active:true,unlimited:false,alwaysPoint:true,x:-1234,y:321}),frame<90?16:0,frame%2?MAX_INPUT-2**43-2**41:0],
  offlineMask:frame<90?0:2,ticks:Math.floor(frame/2),gameHash:frame*12345,nativeHash:(frame+1)%120===0?0x12345678:0}));
const history=new ConfirmedHistory(header);
for(let n=0;n<rows.length;n+=60)history.append(n,packHistoryRows(rows.slice(n,n+60),3));
assert.deepEqual(history.row(124),rows[124]);assert.deepEqual(history.row(63),rows[63]);assert.equal(history.row(125),null);
assert.throws(()=>history.append(124,packHistoryRows(rows.slice(0,1),3)),/顺序/);
await history.checkpoints.append({frame:0,stage:0,bytes:new Uint8Array([1,2,3])});
await history.checkpoints.append({frame:120,stage:1,bytes:new Uint8Array([4,5,6,7])});
assert.deepEqual(history.checkpoints.index().map(({frame,stage})=>[frame,stage]),[[0,0],[120,1]]);
assert.throws(()=>new ConfirmedHistory({...header,players:2}));
const invalid=rows[0];
for(const row of [{...invalid,pair:[NaN,0,0]},{...invalid,pair:[MAX_INPUT+1,0,0]},
  {...invalid,offlineMask:8},{...invalid,offlineMask:1},{...invalid,nativeHash:1}]){
  assert.throws(()=>new ConfirmedHistory(header).append(0,packHistoryRows([row],3)),/输入/);
}
// A contiguous received-input frontier alone must never publish an unresolved
// prediction. This matches the browser's confirmFrames gate before pruning.
const q=new GameQueue(0,true,2);q.arm(0);
for(let n=0;n<3;n++){q.capture(32);q.commit(q.peek());}
q.receive({slot:1,frame:2,buttons:8});assert.equal(q.dirty,2);assert.equal(q.confirmed,3);
assert(q.dirty!==null,'dirty prediction must be reconciled before consumer publication');
q.rewind(2);q.commit(q.peek());assert.equal(q.dirty,null);assert.deepEqual(q.used.get(2),[32,8]);
console.log('PASS: confirmed spectator history, 44-bit touch / policy inputs, offline mask, frame order and corrected-prefix gate');
