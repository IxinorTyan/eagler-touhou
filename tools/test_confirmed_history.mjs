import assert from 'node:assert/strict';
import {ConfirmedHistory,HISTORY_VERSION,packHistoryRows,historyStride} from '../web/netplay/confirmed-history.js';
import {encodeMultiplayerReplay,decodeMultiplayerReplay} from '../web/netplay/history-codec.js';
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
const parts=history.batches.map(b=>b.bytes),raw=new Blob(parts),stream=raw.stream().pipeThrough(new CompressionStream('gzip'));
const compressed={chunks:[await new Response(stream).arrayBuffer()],rawBytes:125*historyStride(3)};
const file=await encodeMultiplayerReplay({...header,frames:125,reason:'已确认前缀'},compressed);
const decoded=await decodeMultiplayerReplay(file);assert.equal(decoded.frames,125);
// Portable attachments survive file partitioning and verify their own digest.
await history.checkpoints.append({frame:0,stage:0,bytes:new Uint8Array([1,2,3])});
await history.checkpoints.append({frame:120,stage:1,bytes:new Uint8Array([4,5,6,7])});
const portable=await encodeMultiplayerReplay({...header,frames:125,reason:'portable'},compressed,null,history.checkpoints.entries);
const portableDecoded=await decodeMultiplayerReplay(portable);
assert.deepEqual(portableDecoded.checkpoints.index(),history.checkpoints.index());
assert.deepEqual(portableDecoded.row(124),rows[124]);
const portableBytes=new Uint8Array(await portable.arrayBuffer()),metaSize=new DataView(portableBytes.buffer).getUint32(8,true);
const portableMeta=JSON.parse(new TextDecoder().decode(portableBytes.subarray(12,12+metaSize)));
async function changedIndex(change){
 const meta=structuredClone(portableMeta);change(meta);const bytes=new TextEncoder().encode(JSON.stringify(meta)),prefix=portableBytes.slice(0,12);
 new DataView(prefix.buffer).setUint32(8,bytes.length,true);return new Blob([prefix,bytes,portableBytes.subarray(12+metaSize)]);
}
await assert.rejects(()=>changedIndex(h=>h.checkpointIndex[1].offset--).then(decodeMultiplayerReplay),/范围/);
await assert.rejects(()=>changedIndex(h=>h.checkpointIndex[0].sha='0'.repeat(64)).then(decodeMultiplayerReplay),/摘要/);
await assert.rejects(()=>changedIndex(h=>h.checkpointIndex[0].frame=1).then(decodeMultiplayerReplay),/顺序/);
await assert.rejects(()=>changedIndex(h=>h.checkpointIndex[1].frame=126).then(decodeMultiplayerReplay),/范围/);
for(let n=0;n<125;n++)assert.deepEqual(decoded.row(n),rows[n]);
assert.throws(()=>decoded.append(125,packHistoryRows(rows.slice(0,1),3)),/顺序/);
const bad=new Uint8Array(await file.arrayBuffer());bad[bad.length-5]^=1;
await assert.rejects(()=>decodeMultiplayerReplay(new Blob([bad])),/损坏/);
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
console.log('PASS: confirmed history, 44-bit touch / policy inputs, offline mask, frame order, gzip integrity and corrected-prefix gate');
