import {sha256} from './netplay/sha256.js';
export const FRAME_VERSION='th05-game-input/3';
export const FRAME_STRIDE=6;
const MAGIC=new TextEncoder().encode('T05FRM03'),MAX=20*1024*1024;
function validate(h){
  if(h?.version!==FRAME_VERSION||!['cn','jp'].includes(h.language)||!h.identity?.match(/^[a-f0-9]{64}$/))throw Error('不是当前游戏输入 Replay 文件；旧时钟轨迹文件不兼容');
  if(!Number.isSafeInteger(h.frames)||h.frames<1||h.frames>Math.floor(MAX/FRAME_STRIDE)||!h.gameHash?.match(/^[a-f0-9]{8}$/))throw Error('Replay 帧数或校验无效');
  if(!Array.isArray(h.initial)||h.initial.length!==128||h.initial.some(n=>!Number.isInteger(n)||n<0||n>255)||h.initial[31]!==0)throw Error('Replay 开局状态无效');
  const r=h.initial;
  if(![75,83,79,67,111,110,102,105,103,0].every((n,i)=>r[i]===n)||r[13]<1||r[13]>6||r[14]>3||r[17]>4||r[18]>2||r[19]>6||r[20]>3||r[21]>1||r[22]>1||r[23]!==0)throw Error('Replay 开局配置超出支持范围');
  if(!Array.isArray(h.checks)||h.checks.length!==Math.ceil(h.frames/120)||h.checks.some((c,i)=>c.frame!==i*120||!c.hash?.match(/^[a-f0-9]{8}$/)))throw Error('Replay 检查点无效');
  if(h.testProfile!==undefined&&!['good','bad','extra'].includes(h.testProfile))throw Error('Replay 测试身份无效');
  if(h.ending!==undefined&&(![253,254,255].includes(h.ending?.sequence)||h.ending.endpoint!=='score'||!h.ending.residentHash?.match(/^[a-f0-9]{8}$/)||!Number.isInteger(h.ending.slowFrames)||h.ending.slowFrames<0||h.ending.slowFrames>0xffffffff))throw Error('Replay 成绩终点无效');
}
export async function encodeFrameReplay(header,compressed){
  validate(header);if(compressed.rawBytes!==header.frames*FRAME_STRIDE)throw Error('Replay 输入帧数不符');
  const payload=new Uint8Array(await new Blob(compressed.chunks).arrayBuffer());
  const meta=new TextEncoder().encode(JSON.stringify({...header,payloadSha:await sha256(payload)}));
  if(meta.length>1024*1024||payload.length>MAX)throw Error('Replay 超出限制');
  const prefix=new Uint8Array(12);prefix.set(MAGIC);new DataView(prefix.buffer).setUint32(8,meta.length,true);
  return new Blob([prefix,meta,payload],{type:'application/octet-stream'});
}
export async function decodeFrameReplay(file){
  if(file.size<12||file.size>MAX+1024*1024)throw Error('Replay 文件大小无效');
  const prefix=new Uint8Array(await file.slice(0,12).arrayBuffer());
  if(!MAGIC.every((b,i)=>prefix[i]===b))throw Error('不是游戏输入 Replay；旧版时钟轨迹文件不兼容');
  const length=new DataView(prefix.buffer).getUint32(8,true);
  if(length>1024*1024||length+12>=file.size)throw Error('Replay 文件头损坏');
  const header=JSON.parse(await file.slice(12,12+length).text());validate(header);
  const payload=new Uint8Array(await file.slice(12+length).arrayBuffer());
  if(await sha256(payload)!==header.payloadSha)throw Error('Replay 数据损坏');
  const reader=new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts=[];let bytes=0;
  for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>header.frames*FRAME_STRIDE){await reader.cancel();throw Error('Replay 解压超出帧数');}parts.push(value);}
  if(bytes!==header.frames*FRAME_STRIDE)throw Error('Replay 输入帧数不符');
  const inputs=new Uint8Array(await new Blob(parts).arrayBuffer()),view=new DataView(inputs.buffer);
  for(let at=0;at<inputs.length;at+=FRAME_STRIDE){
    if(inputs[at+1]>1||[view.getInt16(at+2,true),view.getInt16(at+4,true)].some(x=>x < -8192||x > 8191)||(!inputs[at+1]&&(view.getInt16(at+2,true)||view.getInt16(at+4,true))))throw Error('Replay 触控输入无效或使用了不限速移动');
  }
  return {header,inputs};
}
