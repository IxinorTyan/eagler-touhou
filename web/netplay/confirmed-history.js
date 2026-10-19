import {MAX_INPUT} from '../touch-input.js';
import {encodeConfig} from '../launch-config.js';
export const HISTORY_VERSION='th05-confirmed-input/1';
export const HISTORY_MAX_FRAMES=216000;
export const HISTORY_BATCH_FRAMES=60;
const hex=(s,n)=>typeof s==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(s);
export function historySessionId(){
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const h=Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
export const historyStride=players=>players*8+13;
export function validateHistoryHeader(h){
  if(h?.version!==HISTORY_VERSION||h.protocol!=='th05-netplay/7'||!['cn','jp'].includes(h.language)||
    ![2,3].includes(h.players)||h.config?.players?.length!==h.players)throw Error('多人帧历史身份无效');
  encodeConfig(h.config);
  for(const k of ['identity','coreSha','diskSha','guestSha'])if(!hex(h[k],64))throw Error('多人帧历史资源身份缺失');
  if(!hex(h.checksum,8))throw Error('多人帧历史缺少开局校验');
}
export function packHistoryRows(rows,players){
  const bytes=new Uint8Array(rows.length*historyStride(players)),v=new DataView(bytes.buffer);
  rows.forEach((r,i)=>{
    let at=i*historyStride(players);
    for(const input of r.pair){v.setFloat64(at,input,true);at+=8;}
    v.setUint8(at++,r.offlineMask);v.setUint32(at,r.ticks,true);at+=4;
    v.setUint32(at,r.gameHash,true);v.setUint32(at+4,r.nativeHash,true);
  });
  return bytes;
}
export function historyRow(bytes,index,players){
  const stride=historyStride(players),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let at=index*stride;const pair=[];
  for(let n=0;n<players;n++){pair.push(v.getFloat64(at,true));at+=8;}
  const offlineMask=v.getUint8(at++),ticks=v.getUint32(at,true);at+=4;
  return {pair,offlineMask,ticks,gameHash:v.getUint32(at,true),nativeHash:v.getUint32(at+4,true)};
}
// No wall-clock field. A batch is a contiguous, immutable prefix of executed
// and reconciled logical frames. Callers own network and compression separately.
export class ConfirmedHistory {
  constructor(header){validateHistoryHeader(header);this.header=structuredClone(header);this.batches=[];this.frames=0;this.end=null;}
  append(first,bytes){
    if(this.end||first!==this.frames||!(bytes instanceof Uint8Array)||!bytes.length||bytes.length%historyStride(this.header.players))throw Error('多人帧历史缺帧或顺序错误');
    const count=bytes.length/historyStride(this.header.players);
    if(count>HISTORY_BATCH_FRAMES||this.frames+count>HISTORY_MAX_FRAMES)throw Error('多人帧历史超过容量');
    for(let n=0;n<count;n++){
      const r=historyRow(bytes,n,this.header.players);
      if(r.pair.some(x=>!Number.isSafeInteger(x)||x<0||x>MAX_INPUT)||r.offlineMask>=(1<<this.header.players)||
        r.pair.some((x,slot)=>(r.offlineMask&(1<<slot))&&x!==0)||
        ((first+n+1)%120!==0&&r.nativeHash!==0))throw Error('多人帧历史输入无效');
    }
    const batch={first,bytes:bytes.slice()};this.batches.push(batch);this.frames+=count;return batch;
  }
  finish(reason='prefix'){
    if(!this.end)this.end={frames:this.frames,reason:String(reason).slice(0,250)};
    return this.end;
  }
  row(frame){
    if(!Number.isInteger(frame)||frame<0||frame>=this.frames)return null;
    // Most callers advance in sequence; binary search also handles tail batches
    // flushed early at user export without assuming fixed-size chunk indices.
    let lo=0,hi=this.batches.length-1;
    while(lo<=hi){const mid=(lo+hi)>>>1,b=this.batches[mid],count=b.bytes.length/historyStride(this.header.players);
      if(frame<b.first)hi=mid-1;else if(frame>=b.first+count)lo=mid+1;else return historyRow(b.bytes,frame-b.first,this.header.players);}
    return null;
  }
}
