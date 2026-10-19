import {sha256} from './sha256.js';
import {ConfirmedHistory,validateHistoryHeader,historyStride,HISTORY_MAX_FRAMES,HISTORY_BATCH_FRAMES} from './confirmed-history.js';
const magic=new TextEncoder().encode('T05MP001'),MAX=32*1024*1024;
export async function encodeMultiplayerReplay(header,compressed){
  validateHistoryHeader(header);
  if(!Number.isInteger(header.frames)||header.frames<1||header.frames>HISTORY_MAX_FRAMES||compressed.rawBytes!==header.frames*historyStride(header.players))throw Error('多人录像帧数不符');
  const payload=new Uint8Array(await new Blob(compressed.chunks).arrayBuffer());
  if(payload.length>MAX)throw Error('多人录像超过容量');
  const meta=new TextEncoder().encode(JSON.stringify({...header,payloadSha:await sha256(payload)}));
  if(meta.length>65536)throw Error('多人录像文件头过大');
  const prefix=new Uint8Array(12);prefix.set(magic);new DataView(prefix.buffer).setUint32(8,meta.length,true);
  return new Blob([prefix,meta,payload],{type:'application/octet-stream'});
}
export async function decodeMultiplayerReplay(file){
  if(file.size<13||file.size>MAX+65548)throw Error('多人录像文件大小无效');
  const prefix=new Uint8Array(await file.slice(0,12).arrayBuffer());
  if(!magic.every((x,i)=>prefix[i]===x))throw Error('不是 TH05 多人输入录像；单人 Replay 请使用单人入口');
  const size=new DataView(prefix.buffer).getUint32(8,true);
  if(size>65536||size+12>=file.size)throw Error('多人录像文件头损坏');
  const header=JSON.parse(await file.slice(12,12+size).text());validateHistoryHeader(header);
  if(!Number.isInteger(header.frames)||header.frames<1||header.frames>HISTORY_MAX_FRAMES||typeof header.reason!=='string'||header.reason.length>250)throw Error('多人录像结束信息无效');
  const payload=new Uint8Array(await file.slice(12+size).arrayBuffer());
  if(await sha256(payload)!==header.payloadSha)throw Error('多人录像数据损坏');
  const reader=new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts=[];let length=0;const expected=header.frames*historyStride(header.players);
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>expected)throw Error('多人录像解压超过帧数');parts.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  if(length!==expected)throw Error('多人录像输入缺失');
  const raw=new Uint8Array(await new Blob(parts).arrayBuffer()),history=new ConfirmedHistory(header),stride=historyStride(header.players);
  for(let first=0;first<header.frames;first+=HISTORY_BATCH_FRAMES)history.append(first,raw.subarray(first*stride,Math.min(first+HISTORY_BATCH_FRAMES,header.frames)*stride));
  history.finish(header.reason);return history;
}
