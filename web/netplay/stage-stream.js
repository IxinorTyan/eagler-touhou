import {captureProbeInitial,restoreProbeInitial} from './stage-initial.js';
export const STAGE_STREAM_VERSION='th05-stage-stream/1';
export const STAGE_MAX_EVENTS=512,STAGE_MAX_BYTES=2*1024*1024;
const uint=(n,max=0xffffffff)=>Number.isInteger(n)&&n>=0&&n<=max;
export function validateStageEvents(events,players){
 if(![2,3].includes(players)||!Array.isArray(events)||events.length>STAGE_MAX_EVENTS)throw Error('分面输入批次无效');
 for(const e of events){
  if(!Array.isArray(e))throw Error('分面输入无效');
  if(e[0]===0){if(e.length!==4||!uint(e[1],65535)||!uint(e[2],1)||!uint(e[3],255))throw Error('剧情输入无效');}
  else if(e[0]===1){
   if(e.length!==8||!uint(e[1],65535)||!uint(e[2],1)||!Array.isArray(e[3])||e[3].length!==players-1||
     !Array.from(e[3]).every(n=>uint(n,127))||!Array.isArray(e[4])||e[4].length!==24||!Array.from(e[4]).every(n=>uint(n,255))||
     !uint(e[5],(1<<players)-1)||!uint(e[6])||!uint(e[7]))throw Error('分面战斗输入无效');
  }else if(e[0]===2){
   const d=e[1];if(e.length!==2||d?.version!=='th05-stage-initial/1'||!uint(d.stage,6)||d.players!==players||
    !Array.isArray(d.bytes)||d.bytes.length!==490||!Array.from(d.bytes).every(n=>uint(n,255))||
    !/^[a-f0-9]{64}$/.test(d.diskSha)||!Array.isArray(d.config)||d.config.length!==12||!Array.from(d.config).every(n=>uint(n,255))||
    !/^[a-f0-9]{8}$/.test(d.checksum))throw Error('分面开局无效');
  }else throw Error('分面输入类型无效');
 }
}
export function stageLayout(mod,patch,packed){
 const origin=mod.nativeExports().thCoreState(0),code=origin+(packed&65535)*16,data=origin+(packed>>>16)*16;
 const v=new DataView(mod.HEAPU8.buffer),resident=origin+v.getUint16(data+0x41fe,true)*16+v.getUint16(data+0x41fc,true);
 if(data-code!==(patch.data_segment-patch.code_segment)*16)throw Error('分面内存定位不一致');
 return {origin,code,data,resident};
}
function hashSpans(heap,spans){let h=2166136261;for(const [at,size]of spans)for(let i=at;i<at+size;i++)h=Math.imul(h^heap[i],16777619);return h>>>0;}
export function stageProof(heap,l,patch){
 const d=l.data,c=l.code,e=patch.entry_map,m=c+patch.mailbox_cs_offset;
 const game=hashSpans(heap,[[d+0x418,4],[d+0x36d0,40],[d+0x4ad4,4],[d+0x5764,20],[d+0x3526,258],
  [d+0x41dc,2],[m+16,4],[m+40,50],[c+e.p3_state,50],[c+e.personal_stats,96],[c+e.out_flags,3]]);
 const tick=new DataView(heap.buffer).getUint32(m+16,true);
 const world=tick%120===0?hashSpans(heap,[[d+0x5aea,0x400],[d+0x5f2a,400*32],[d+0x93fa,32*64],
  [d+0xba8e,64*18],[d+0xc740,224*18],[d+0x9f04,0x460]]):0;
 return [game,world];
}
// The recorder is per synchronous step, so predicted observations stay inside
// existing rollback effects and are discarded/rebuilt with those effects.
export function recordStageSignal(mod,patch,port,packed,events){
 if(events.length>=STAGE_MAX_EVENTS)throw Error('分面采样超过本步容量');
 const l=stageLayout(mod,patch,packed),h=mod.HEAPU8,v=new DataView(h.buffer),d=l.data,c=l.code;
 if(port===0x7fe0){events.push([2,captureProbeInitial(h,l,patch)]);return;}
 if(port===0x7fe4){events.push([0,v.getUint16(d+0x3064,true),h[d+0x3066],h[l.origin+0x538]]);return;}
 if(port!==0x7fe2)return;
 const guests=[v.getUint16(c+patch.mailbox_cs_offset+22,true)|(h[c+patch.mailbox_cs_offset+24]?64:0)];
 if(h[c+patch.entry_map.player_count]===3)guests.push(v.getUint16(c+patch.entry_map.p3_input,true)|(h[c+patch.entry_map.p3_focus]?64:0));
 events.push([1,v.getUint16(d+0x3064,true),h[d+0x3066],guests,
  Array.from(h.subarray(c+patch.entry_map.touch_state,c+patch.entry_map.touch_state+24)),
  h[c+patch.entry_map.offline_mask],...stageProof(h,l,patch)]);
}
export function applyStageEvent(mod,patch,port,packed,event){
 const l=stageLayout(mod,patch,packed),h=mod.HEAPU8,v=new DataView(h.buffer),d=l.data,c=l.code;
 const kind=port===0x7fe0?2:port===0x7fe4?0:port===0x7fe2?1:-1;
 if(kind<0)return;
 if(event?.[0]!==kind)throw Error('分面原生输入边界不一致');
 if(kind===2){restoreProbeInitial(event[1],h,l,patch);return;}
 if(kind===1){
  const proof=stageProof(h,l,patch);
  if(proof[0]!==event[6]||proof[1]!==event[7])throw Error('分面游戏状态校验不一致');
  v.setUint16(c+patch.mailbox_cs_offset+22,event[3][0]&63,true);h[c+patch.mailbox_cs_offset+24]=event[3][0]>>>6;
  v.setUint16(c+patch.entry_map.p3_input,(event[3][1]||0)&63,true);h[c+patch.entry_map.p3_focus]=(event[3][1]||0)>>>6;
  h.set(event[4],c+patch.entry_map.touch_state);h[c+patch.entry_map.offline_mask]=event[5];
  for(let slot=0;slot<3;slot++)if(event[5]&(1<<slot))h[c+patch.entry_map.out_flags+slot]=2;
 }else h[l.origin+0x538]=event[3];
 v.setUint16(d+0x3064,event[1],true);h[d+0x3066]=event[2];
}
