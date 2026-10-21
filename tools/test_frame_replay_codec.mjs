import assert from 'node:assert/strict';
import {FRAME_VERSION,FRAME_STRIDE,encodeFrameReplay,decodeFrameReplay} from '../web/frame-replay-codec.js';
const initial=Array(128).fill(0);initial.splice(0,10,75,83,79,67,111,110,102,105,103,0);initial[13]=3;initial[14]=3;
const masks=[0,4,4,4,32,64,128],inputs=Uint8Array.from(masks.flatMap(mask=>[mask,0,0,0,0,0])),payload=new Uint8Array(await new Response(new Blob([inputs]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const header={version:FRAME_VERSION,language:'cn',identity:'a'.repeat(64),frames:masks.length,gameHash:'12345678',initial,checks:[{frame:0,hash:'12345678'}]};
const encoded=await encodeFrameReplay(header,{rawBytes:inputs.length,chunks:[payload]});
const clearHeader={...header,testProfile:'extra',ending:{sequence:253,endpoint:'score',residentHash:'87654321',slowFrames:12}};
assert.deepEqual((await decodeFrameReplay(await encodeFrameReplay(clearHeader,{rawBytes:inputs.length,chunks:[payload]}))).header.ending,clearHeader.ending);
await assert.rejects(()=>encodeFrameReplay({...header,testProfile:'other'},{rawBytes:7*FRAME_STRIDE,chunks:[payload]}),/测试身份/);
await assert.rejects(()=>encodeFrameReplay({...clearHeader,ending:{...clearHeader.ending,slowFrames:-1}},{rawBytes:7*FRAME_STRIDE,chunks:[payload]}),/成绩终点/);
assert.deepEqual((await decodeFrameReplay(encoded)).inputs,inputs);
await assert.rejects(()=>decodeFrameReplay(new Blob(['T05EXT01'])),/大小/);
await assert.rejects(()=>encodeFrameReplay({...header,frames:8},{rawBytes:7*FRAME_STRIDE,chunks:[payload]}),/帧数/);
await assert.rejects(()=>encodeFrameReplay({...header,checks:[]},{rawBytes:7*FRAME_STRIDE,chunks:[payload]}),/检查点/);
const invalid=initial.slice();invalid[20]=255;
await assert.rejects(()=>encodeFrameReplay({...header,initial:invalid},{rawBytes:7*FRAME_STRIDE,chunks:[payload]}),/配置/);
const corrupt=new Uint8Array(await encoded.arrayBuffer());corrupt[corrupt.length-1]^=1;
await assert.rejects(()=>decodeFrameReplay(new Blob([corrupt])),/损坏/);
console.log('PASS: game input file round trip, frame/checkpoint limits, native config bounds and corruption rejection');

for(const badInput of [[32,3,0,0,0,0],[32,0,1,0,0,0],[32,1,0,64,0,0]]){
 const bytes=Uint8Array.from(badInput),payload=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
 const file=await encodeFrameReplay({...header,frames:1},{rawBytes:6,chunks:[payload]});
 await assert.rejects(()=>decodeFrameReplay(file),/触控输入/);
}
console.log('PASS unlimited flags, inactive displacement and out-of-range touch rejection');
