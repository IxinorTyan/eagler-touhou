import {HOST_VERSION,CLOCK_BYTES} from './external-replay-host.js';
import {sha256} from './netplay/sha256.js';
import {normalizePractice,validatePracticeOptions} from './practice-config.js';
// Browser storage only: clock and input tapes are independently compressed.
const MAGIC=new TextEncoder().encode('T05EXT02'),LIMIT=128*1024*1024,HEADER_LIMIT=64*1024;
export const MAX_CLOCK_BYTES=512*1024*1024,MAX_EVENT_BYTES=32*1024*1024;
export function validateReplayHeader(h,clockBytes){
  if(h?.version!==HOST_VERSION||h.mode!=='solo'||!['cn','jp'].includes(h.language)||typeof h.independentMusic!=='boolean')throw Error('不支持的 Replay 类型');
  if(!Number.isSafeInteger(h.result?.boundary)||h.result.boundary<1||!Number.isSafeInteger(h.result.clockCount)||h.result.clockCount<1||h.result.clockCount*CLOCK_BYTES!==clockBytes||clockBytes>MAX_CLOCK_BYTES)throw Error('Replay 长度不匹配');
  if(typeof h.identity!=='string'||!h.identity.match(/^[a-f0-9]{64}$/)||typeof h.result.guestHash!=='string'||!h.result.guestHash.match(/^[a-f0-9]{8}$/)||typeof h.result.guestSha256!=='string'||!h.result.guestSha256.match(/^[a-f0-9]{64}$/))throw Error('Replay 版本身份或最终内存校验缺失，无法生成有效录像');
  if(!Array.isArray(h.events))throw Error('Replay 输入缺失');
  if(h.practice)normalizePractice(h.practice);
  let last=0,total=0;
  for(const event of h.events){
    if(!Number.isSafeInteger(event.boundary)||event.boundary<1||event.boundary<=last||event.boundary>h.result.boundary||!Array.isArray(event.commands)||!event.commands.length)throw Error('Replay 输入顺序无效');
    last=event.boundary;
    for(const c of event.commands){
      if(++total>1000000)throw Error('Replay 输入超过容量');
      if(c.type==='key'){
        if(![265,264,263,262,88,90,340,256,257].includes(c.code)||typeof c.down!=='boolean')throw Error('Replay 输入命令无效');
      }else if(c.type==='input'){
        const i=c.input,t=i?.touch;
        if(!i||i.generation!==undefined&&(!Number.isInteger(i.generation)||i.generation<0||i.generation>65535)||!Number.isInteger(i.points)||i.points<0||i.points>9)throw Error('Replay 触控命令无效');
        if(t!==null&&t!==undefined&&(!t||typeof t.active!=='boolean'||typeof t.unlimited!=='boolean'||!Number.isFinite(t.x)||!Number.isFinite(t.y)||Math.abs(t.x)>8192||Math.abs(t.y)>8192))throw Error('Replay 触控命令无效');
      }else if(c.type==='practice-options'&&h.practice){validatePracticeOptions(c.options,true);}
      else throw Error('Replay 输入命令无效');
    }
  }
}
async function inflate(bytes,expected){
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),parts=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>expected){await reader.cancel();throw Error('Replay 解压长度越界');}parts.push(value);}
  if(total!==expected)throw Error('Replay 解压长度不符');
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
export async function encodeReplay(header,{chunks,rawBytes}){
  validateReplayHeader(header,rawBytes);
  const eventJSON=new TextEncoder().encode(JSON.stringify(header.events));
  if(eventJSON.length>MAX_EVENT_BYTES)throw Error('Replay 输入超过容量');
  const eventTape=new Uint8Array(await new Response(new Blob([eventJSON]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const clockTape=new Uint8Array(await new Blob(chunks).arrayBuffer()),payload=new Uint8Array(clockTape.length+eventTape.length);
  payload.set(clockTape);payload.set(eventTape,clockTape.length);
  const {events,...metadata}=header;
  const json=new TextEncoder().encode(JSON.stringify({...metadata,compression:'gzip',rawClockBytes:rawBytes,clockPayloadBytes:clockTape.length,rawEventBytes:eventJSON.length,payloadSha256:await sha256(payload)}));
  if(json.length>HEADER_LIMIT||payload.length+json.length+12>LIMIT)throw Error('Replay 超过容量限制');
  const prefix=new Uint8Array(12);prefix.set(MAGIC);new DataView(prefix.buffer).setUint32(8,json.length,true);
  return new Blob([prefix,json,payload],{type:'application/octet-stream'});
}
export async function decodeReplay(file){
  if(file.size<12||file.size>LIMIT)throw Error('Replay 文件大小无效');
  const prefix=new Uint8Array(await file.slice(0,12).arrayBuffer());if(!MAGIC.every((n,i)=>prefix[i]===n))throw Error('不是 TH05 浏览器 Replay 文件');
  const size=new DataView(prefix.buffer).getUint32(8,true);if(size>HEADER_LIMIT||size+12>=file.size)throw Error('Replay 文件头损坏');
  const header=JSON.parse(await file.slice(12,12+size).text()),payload=new Uint8Array(await file.slice(12+size).arrayBuffer());
  if(header.compression!=='gzip'||!Number.isSafeInteger(header.rawClockBytes)||header.rawClockBytes<1||header.rawClockBytes>MAX_CLOCK_BYTES||!Number.isSafeInteger(header.rawEventBytes)||header.rawEventBytes<2||header.rawEventBytes>MAX_EVENT_BYTES||!Number.isSafeInteger(header.clockPayloadBytes)||header.clockPayloadBytes<1||header.clockPayloadBytes>=payload.length||await sha256(payload)!==header.payloadSha256)throw Error('Replay 数据损坏');
  const clocks=await inflate(payload.subarray(0,header.clockPayloadBytes),header.rawClockBytes);
  const events=await inflate(payload.subarray(header.clockPayloadBytes),header.rawEventBytes);
  header.events=JSON.parse(new TextDecoder().decode(events));
  validateReplayHeader(header,clocks.length);return {header,clocks};
}
