import {HOST_VERSION,CLOCK_BYTES} from './external-replay-host.js';
import {sha256} from './netplay/sha256.js';
// Binary clock tape, JSON metadata and boundary inputs; no emulator filesystem.
const MAGIC=new TextEncoder().encode('T05EXT01'),LIMIT=128*1024*1024,HEADER_LIMIT=2*1024*1024;
export function validateReplayHeader(h,clockBytes){
  if(h?.version!==HOST_VERSION||h.mode!=='solo'||!['cn','jp'].includes(h.language)||h.independentMusic!==false)throw Error('不支持的 Replay 类型');
  if(!Number.isSafeInteger(h.result?.boundary)||h.result.boundary<1||!Number.isSafeInteger(h.result.clockCount)||h.result.clockCount<1||h.result.clockCount*CLOCK_BYTES!==clockBytes)throw Error('Replay 长度不匹配');
  if(typeof h.identity!=='string'||!h.identity.match(/^[a-f0-9]{64}$/)||typeof h.result.guestHash!=='string'||!h.result.guestHash.match(/^[a-f0-9]{8}$/)||typeof h.result.guestSha256!=='string'||!h.result.guestSha256.match(/^[a-f0-9]{64}$/))throw Error('Replay 版本身份或最终内存校验缺失，无法生成有效录像');
  if(!Array.isArray(h.events))throw Error('Replay 输入缺失');
  let last=0,total=0;
  for(const event of h.events){
    if(!Number.isSafeInteger(event.boundary)||event.boundary<1||event.boundary<=last||event.boundary>h.result.boundary||!Array.isArray(event.commands)||!event.commands.length)throw Error('Replay 输入顺序无效');
    last=event.boundary;
    for(const c of event.commands){
      if(++total>1000000||c.type!=='key'||![265,264,263,262,88,90,340,256,257].includes(c.code)||typeof c.down!=='boolean')throw Error('Replay 输入命令无效');
    }
  }
}
export async function encodeReplay(header,{chunks,rawBytes}){
  validateReplayHeader(header,rawBytes);
  const compressed=new Uint8Array(await new Blob(chunks).arrayBuffer());
  header={...header,compression:'gzip',rawClockBytes:rawBytes,clockSha256:await sha256(compressed)};
  const json=new TextEncoder().encode(JSON.stringify(header));if(json.length>HEADER_LIMIT||compressed.length+json.length+12>LIMIT)throw Error('实验 Replay 超过容量限制');
  const prefix=new Uint8Array(12);prefix.set(MAGIC);new DataView(prefix.buffer).setUint32(8,json.length,true);
  return new Blob([prefix,json,compressed],{type:'application/octet-stream'});
}
export async function decodeReplay(file){
  if(file.size<12||file.size>LIMIT)throw Error('Replay 文件大小无效');
  const prefix=new Uint8Array(await file.slice(0,12).arrayBuffer());if(!MAGIC.every((n,i)=>prefix[i]===n))throw Error('不是 TH05 外部 Replay 实验文件');
  const size=new DataView(prefix.buffer).getUint32(8,true);if(size>HEADER_LIMIT||size+12>=file.size)throw Error('Replay 文件头损坏');
  const header=JSON.parse(await file.slice(12,12+size).text()),compressed=new Uint8Array(await file.slice(12+size).arrayBuffer());
  if(header.compression!=='gzip'||!Number.isSafeInteger(header.rawClockBytes)||header.rawClockBytes<1||header.rawClockBytes>120*1024*1024||await sha256(compressed)!==header.clockSha256)throw Error('Replay 时钟数据损坏');
  // Bound decompression before accumulating output, including malicious files.
  const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),parts=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>header.rawClockBytes){await reader.cancel();throw Error('Replay 解压长度越界');}parts.push(value);}
  const clocks=new Uint8Array(await new Blob(parts).arrayBuffer());
  if(clocks.length!==header.rawClockBytes)throw Error('Replay 解压长度不符');
  validateReplayHeader(header,clocks.length);return {header,clocks};
}
