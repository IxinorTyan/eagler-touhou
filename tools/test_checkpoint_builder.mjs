import assert from 'node:assert/strict';
import {createCheckpointBuilder} from '../web/checkpoint-builder.js';
import {packHistoryRows,HISTORY_VERSION} from '../web/netplay/confirmed-history.js';
const header={version:HISTORY_VERSION,protocol:'th05-netplay/9',language:'cn',players:2,
 config:{rank:1,players:[0,1].map(character=>({character,spares:3,bombs:3}))},
 identity:'a'.repeat(64),coreSha:'b'.repeat(64),diskSha:'c'.repeat(64),guestSha:'d'.repeat(64),checksum:'12345678'};
let fail=false;const cores=[];
globalThis.Worker=class{
 constructor(){this.frame=0;this.stage=0;this.terminated=false;cores.push(this);}
 terminate(){this.terminated=true;}
 postMessage(data){queueMicrotask(()=>{
  if(this.terminated)return;let result;
  if(data.type==='boot')result=fail?{type:'error',message:'replica proof failed'}:{type:'ready',...header,historyHeader:header,state:{stage:0}};
  if(data.type==='checkpoint-save')result={type:'checkpoint-saved',frame:this.frame,stage:this.stage,identity:header.identity,bytes:new Uint8Array([this.frame&255])};
  if(data.type==='history-slice'){assert(data.rows.length<=32);this.frame+=data.rows.length;this.stage=this.frame>=1000?1:0;result={type:'history-sliced',frame:this.frame,stage:this.stage};}
  if(result)this.onmessage({data:result});
 });}
};
const points=[];let completed;
const done=new Promise(resolve=>completed=resolve),builder=createCheckpointBuilder();
builder.onmessage=({data})=>{if(data.type==='checkpoint')points.push(data);if(data.type==='error')throw Error(data.message);if(data.type==='done')completed();};
builder.postMessage({type:'boot',header});
for(let first=0;first<3720;first+=60)builder.postMessage({type:'append',first,bytes:packHistoryRows(Array.from({length:60},()=>({pair:[32,32],offlineMask:0,ticks:0,gameHash:0,nativeHash:0})),2)});
builder.postMessage({type:'end'});await done;
assert.deepEqual(points.map(p=>[p.frame,p.stage]),[[0,0],[1024,1],[1800,1],[3600,1],[3720,1]]);
assert(cores[0].terminated);
fail=true;const failed=createCheckpointBuilder();
await new Promise(resolve=>{failed.onmessage=({data})=>{assert.equal(data.type,'error');assert.equal(data.message,'replica proof failed');resolve();};failed.postMessage({type:'boot',header});});
assert(cores[1].terminated);builder.terminate();failed.terminate();
console.log('PASS independent builder stage boundaries, fixed periodic points, final tail and replica failure retirement');
