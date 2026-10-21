import {sha256} from './sha256.js';
import {ConfirmedHistory,validateHistoryHeader,historyStride,HISTORY_MAX_FRAMES,HISTORY_BATCH_FRAMES} from './confirmed-history.js';
const magic=new TextEncoder().encode('T05MP001'),stageMagic=new TextEncoder().encode('T05MP002'),checkpointMagic=new TextEncoder().encode('T05MP003'),MAX=160*1024*1024,STAGE_RAW_MAX=16*1024*1024;
export async function encodeMultiplayerReplay(header,compressed,stageRecords=null,checkpoints=[]){
  validateHistoryHeader(header);
  if(!Number.isInteger(header.frames)||header.frames<1||header.frames>HISTORY_MAX_FRAMES||compressed.rawBytes!==header.frames*historyStride(header.players))throw Error('多人录像帧数不符');
  const sync=new Uint8Array(await new Blob(compressed.chunks).arrayBuffer());
  let stage=null,stageRawBytes=0;
  if(header.stageObservation===1&&stageRecords?.length){
    try{
      const bytes=new TextEncoder().encode(JSON.stringify(stageRecords));
      if(bytes.length<=STAGE_RAW_MAX){stage=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());stageRawBytes=bytes.length;}
    }catch{/* The optional shortcut cannot prevent exporting confirmed input. */}
  }
  const entries=checkpoints.filter(e=>e.frame<=header.frames);
  if(entries.length>128||entries.length&&entries[0].frame!==0)throw Error('检查点文件索引无效');
  let offset=sync.length+(stage?.length||0);
  const checkpointIndex=entries.map((e,i)=>{if(i&&e.frame<=entries[i-1].frame)throw Error('检查点顺序无效');const item={frame:e.frame,stage:e.stage,sha:e.sha,offset,size:e.bytes.length};offset+=e.bytes.length;return item;});
  const payload=new Uint8Array(await new Blob([sync,...(stage?[stage]:[]),...entries.map(e=>e.bytes)]).arrayBuffer());
  if(payload.length>MAX)throw Error('多人录像超过容量');
  const meta=new TextEncoder().encode(JSON.stringify({...header,...(stage||entries.length?{syncPayloadBytes:sync.length,stageRawBytes}:{}),...(entries.length?{checkpointIndex,stagePayloadBytes:stage?.length||0}:{}),payloadSha:await sha256(payload)}));
  if(meta.length>65536)throw Error('多人录像文件头过大');
  const prefix=new Uint8Array(12);prefix.set(entries.length?checkpointMagic:stage?stageMagic:magic);new DataView(prefix.buffer).setUint32(8,meta.length,true);
  return new Blob([prefix,meta,payload],{type:'application/octet-stream'});
}
export async function decodeMultiplayerReplay(file){
  if(file.size<13||file.size>MAX+65548)throw Error('多人录像文件大小无效');
  const prefix=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const checkpointed=checkpointMagic.every((x,i)=>prefix[i]===x),stageV2=stageMagic.every((x,i)=>prefix[i]===x);
  if(!checkpointed&&!stageV2&&!magic.every((x,i)=>prefix[i]===x))throw Error('不是 TH05 多人输入录像；单人 Replay 请使用单人入口');
  const size=new DataView(prefix.buffer).getUint32(8,true);
  if(size>65536||size+12>=file.size)throw Error('多人录像文件头损坏');
  const header=JSON.parse(await file.slice(12,12+size).text());validateHistoryHeader(header);
  const staged=stageV2||(checkpointed&&header.stagePayloadBytes>0);
  if(!Number.isInteger(header.frames)||header.frames<1||header.frames>HISTORY_MAX_FRAMES||typeof header.reason!=='string'||header.reason.length>250)throw Error('多人录像结束信息无效');
  const payload=new Uint8Array(await file.slice(12+size).arrayBuffer());
  if(await sha256(payload)!==header.payloadSha)throw Error('多人录像数据损坏');
  if(staged&&(header.stageObservation!==1||!Number.isInteger(header.syncPayloadBytes)||header.syncPayloadBytes<1||header.syncPayloadBytes>=payload.length||
    !Number.isInteger(header.stageRawBytes)||header.stageRawBytes<2||header.stageRawBytes>STAGE_RAW_MAX))throw Error('分面录像分区大小无效');
  if(checkpointed&&(!Number.isInteger(header.syncPayloadBytes)||header.syncPayloadBytes<1||header.syncPayloadBytes>=payload.length||!Number.isInteger(header.stagePayloadBytes)||header.stagePayloadBytes<0||!Array.isArray(header.checkpointIndex)||!header.checkpointIndex.length||header.checkpointIndex.length>128))throw Error('检查点文件分区无效');
  const syncPayload=staged||checkpointed?payload.subarray(0,header.syncPayloadBytes):payload;
  const reader=new Blob([syncPayload]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts=[];let length=0;const expected=header.frames*historyStride(header.players);
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>expected)throw Error('多人录像解压超过帧数');parts.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  if(length!==expected)throw Error('多人录像输入缺失');
  const raw=new Uint8Array(await new Blob(parts).arrayBuffer()),history=new ConfirmedHistory(header),stride=historyStride(header.players);
  for(let first=0;first<header.frames;first+=HISTORY_BATCH_FRAMES)history.append(first,raw.subarray(first*stride,Math.min(first+HISTORY_BATCH_FRAMES,header.frames)*stride));
  if(staged){
    const reader=new Blob([payload.subarray(header.syncPayloadBytes,checkpointed?header.syncPayloadBytes+header.stagePayloadBytes:payload.length)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),parts=[];let length=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>header.stageRawBytes)throw Error('分面录像解压越界');parts.push(value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}
    if(length!==header.stageRawBytes)throw Error('分面录像数据缺失');
    const records=JSON.parse(await new Blob(parts).text());
    if(!Array.isArray(records)||records.length>header.frames)throw Error('分面录像索引无效');
    let previous=-1;
    for(const entry of records){
      if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<=previous||entry[0]>=header.frames)throw Error('分面录像索引顺序无效');
      if(entry[0]!==previous+1)history.stages.append(previous+1,1,undefined);
      history.stages.append(entry[0],1,[entry[1]]);previous=entry[0];
    }
  }
  if(checkpointed){
    let offset=header.syncPayloadBytes+header.stagePayloadBytes;
    for(const e of header.checkpointIndex){
      if(!Number.isInteger(e.offset)||e.offset!==offset||!Number.isInteger(e.size)||e.size<1||e.offset+e.size>payload.length||e.frame>header.frames)throw Error('检查点文件索引范围无效');
      await history.checkpoints.append({...e,bytes:payload.slice(offset,offset+e.size)});offset+=e.size;
    }
    if(offset!==payload.length)throw Error('检查点文件尾部无效');history.checkpointsDone=true;
  }
  if(history.tainted)throw Error('本局使用过作弊辅助，不支持 Replay 回放');
  history.finish(header.reason);return history;
}
