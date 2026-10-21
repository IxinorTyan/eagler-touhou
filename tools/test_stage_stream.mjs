import assert from 'node:assert/strict';
import {encodeConfig} from '../web/launch-config.js';
import {validateStageEvents} from '../web/netplay/stage-stream.js';
import {StageHistory} from '../web/netplay/stage-history.js';
import {ConfirmedHistory,packHistoryRows} from '../web/netplay/confirmed-history.js';
const header={version:'th05-confirmed-input/1',protocol:'th05-netplay/9',language:'cn',players:2,
 config:{rank:1,players:[{character:0,spares:3,bombs:3},{character:1,spares:3,bombs:3}]},
 identity:'a'.repeat(64),coreSha:'b'.repeat(64),diskSha:'c'.repeat(64),guestSha:'d'.repeat(64),checksum:'12345678'};
const initial=[2,{version:'th05-stage-initial/1',diskSha:header.diskSha,stage:1,players:2,config:Array.from(encodeConfig(header.config)),bytes:Array(490).fill(0),checksum:'00000000'}];
const poll=[0,32,1,0],update=[1,32,0,[32],Array(24).fill(0),0,123,0];
validateStageEvents([initial,poll,update],2);
for(const mutate of [e=>delete e[1][3][0],e=>delete e[1][4][5],e=>{e[1][5]=4;},e=>{e[1][2]=2;},e=>{e[1][6]=-1;}]){const e=structuredClone([poll,update]);mutate(e);assert.throws(()=>validateStageEvents(e,2));}
for(const key of ['config','bytes']){const e=structuredClone(initial);delete e[1][key][0];assert.throws(()=>validateStageEvents([e],2));}
assert.throws(()=>validateStageEvents(Array(513).fill(poll),2));
assert.throws(()=>validateStageEvents([poll],1));
const cache=new StageHistory(header);
cache.append(0,2,[[initial,poll],[update]]);
assert.equal(cache.nearest(2).first,0);
const read=cache.frames(0,2);assert.deepEqual(read[0],[initial,poll]);
const next=structuredClone(initial);next[1].stage=2;
cache.append(2,1,[[next,poll]]);assert.equal(cache.nearest(2).stage,2);
cache.append(3,1,[null]);assert.equal(cache.nearest(5),null);
cache.append(4,1,[[poll]]);assert.equal(cache.frames(4,1)[0],null,'a gap requires a new initial descriptor');
const cap=new StageHistory(header,{stageBytes:JSON.stringify([initial]).length+10,totalBytes:1e6});
cap.append(0,1,[[initial]]);cap.append(1,1,[[update]]);assert.equal(cap.bytes,0);assert.equal(cap.nearest(2),null);
const trim=new StageHistory(header,{stageBytes:1e6,totalBytes:JSON.stringify([initial]).length+10});
trim.append(0,1,[[initial]]);trim.append(1,1,[[next]]);assert.equal(trim.segments.length,1);assert.equal(trim.frames(0,1)[0],null);assert(trim.bytes<=trim.totalBytes);
const bad=new StageHistory(header);bad.append(0,1,[[[2,{...initial[1],diskSha:'0'.repeat(64)}]]]);assert(bad.error);assert.equal(bad.bytes,0);
const history=new ConfirmedHistory(header);
const row={pair:[0,0],offlineMask:0,ticks:0,gameHash:0,nativeHash:0};
history.append(0,packHistoryRows([row],2),[[[99]]]);assert.equal(history.frames,1);assert.deepEqual(history.row(0),row);assert(history.stages.error,'bad optional sidecar preserves confirmed sync history');
console.log('PASS strict stage inputs, bounded stage cache, gap recovery and independent sync fallback');
import {encodeMultiplayerReplay,decodeMultiplayerReplay} from '../web/netplay/history-codec.js';
const stagedHeader={...header,stageObservation:1,frames:5,reason:'stage codec fixture'};
const raw=packHistoryRows(Array(5).fill(row),2);
const compressed={rawBytes:raw.length,chunks:[await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()]};
const records=[[1,[initial,poll]],[2,[update]],[4,[next,poll]]];
const file=await encodeMultiplayerReplay(stagedHeader,compressed,records);
assert.equal(new TextDecoder().decode(await file.slice(0,8).arrayBuffer()),'T05MP002');
const decoded=await decodeMultiplayerReplay(file);
assert.equal(decoded.frames,5);assert.deepEqual(decoded.stages.export(5),records);assert.equal(decoded.stages.nearest(3).first,1);assert.equal(decoded.stages.nearest(5).stage,2);
const legacy=await encodeMultiplayerReplay(stagedHeader,compressed);
assert.equal(new TextDecoder().decode(await legacy.slice(0,8).arrayBuffer()),'T05MP001');assert.equal((await decodeMultiplayerReplay(legacy)).stages.records.size,0);
const corrupt=new Uint8Array(await file.arrayBuffer());corrupt[corrupt.length-8]^=1;await assert.rejects(()=>decodeMultiplayerReplay(new Blob([corrupt])),/损坏/);
for(const index of [[[1,[initial]],[1,[poll]]],[[5,[initial]]]])await assert.rejects(()=>encodeMultiplayerReplay(stagedHeader,compressed,index).then(decodeMultiplayerReplay),/索引/);
console.log('PASS v1/v2 replay round trip, stage gaps, fixed-prefix export, corrupt payload and invalid index');
