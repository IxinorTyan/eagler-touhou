// Appended only by the resource-route fixture. No production endpoint.
import {captureProbeInitial,restoreProbeInitial} from './stage-probe-state.mjs';
let stageRestore=null,stageCaptured=null,stageSamples=[],stageMarkers=[],stagePattern=false,stageCurrentPair=null,stageRings=[],stageDebug={},stageDebugEnabled=false,stageInputs=[],stagePlayback=null;
function stageLayout(packed){
 const origin=mod.nativeExports().thCoreState(0),code=origin+(packed&65535)*16,data=origin+(packed>>>16)*16;
 const v=new DataView(mod.HEAPU8.buffer),resident=origin+v.getUint16(data+0x41fe,true)*16+v.getUint16(data+0x41fc,true);
 return {origin,code,data,resident};
}
function stageHash(bytes){let h=2166136261;for(const n of bytes)h=Math.imul(h^n,16777619);return h>>>0;}
function stageMarker(port,packed){
 const l=stageLayout(packed),h=mod.HEAPU8,v=new DataView(h.buffer),stage=h[l.data+0x576e];
 if(port===0x7fe3){
  if(stage>0){const api=mod.nativeExports(),sp=v.getUint32(api.thCoreState(2)+16,true)&65535,ss=v.getUint32(api.thCpuState(7)+8,true)&65535;
   stageRings.push({sample:stageSamples.length,index:h[l.data+0x3626],stack:Array.from({length:8},(_,i)=>v.getUint16(l.origin+ss*16+sp+36+i*2,true))});}
  return;
 }
 if(port===0x7fe0){
  if(stageRestore&&stage===stageRestore.stage){
   restoreProbeInitial(stageRestore,h,l,patch);stageRestore=null;
  }
  stageCaptured=captureProbeInitial(h,l,patch);
 }
 if(port!==0x7fe2)stageMarkers.push({port,stage,seed:v.getUint32(l.data+0x418,true),tick,frame});
 if(port===0x7fe2&&stage>0){
  if(stageDebugEnabled&&[0,534,535,536].includes(stageSamples.length))stageDebug[stageSamples.length]=Array.from(h.slice(l.data,l.data+65536));
  if(stagePattern){
   const n=stageSamples.length,count=h[l.code+patch.entry_map.player_count];
   const pair=stagePlayback?stagePlayback[n]:Array.from({length:count},(_,slot)=>32|((Math.floor(n/75)+slot)%2?4:8)|(n===300+slot*90?16:0)|(n%100<50?64:0));
   if(!Array.isArray(pair)||pair.length!==count)throw Error('Stage input stream exhausted');
   stageInputs.push(pair.slice());
   stageCurrentPair=pair;input(pair);v.setUint16(l.data+0x3064,pair[0]&63,true);h[l.data+0x3066]=pair[0]&64?1:0;
  }
  const ranges=[[0x418,4],[0x36d0,40],[0x4ad4,4],[0x576e,10]],bytes=ranges.flatMap(([o,n])=>Array.from(h.slice(l.data+o,l.data+o+n)));
  const world=Object.fromEntries([['sparks',0x5aea,0x400],['bullets',0x5f2a,400*32],['enemies',0x93fa,32*64],['shots',0xba8e,64*18],['extraShots',0xc740,224*18],['items',0x9f04,0x460],['randomRing',0x3526,258]].map(([name,o,n])=>[name,stageHash(h.subarray(l.data+o,l.data+o+n))]));
  let activeBullets=0,activeEnemies=0;
  for(let i=0;i<400;i++)if(h[l.data+0x5f2a+i*32]===1)activeBullets++;
  for(let i=0;i<32;i++)if(h[l.data+0x93fa+i*64])activeEnemies++;
  stageSamples.push({stage,stageFrame:v.getUint16(l.data+0x5764,true),hash:stageHash(bytes),bytes,world,activeBullets,activeEnemies,
   ringIndex:v.getUint16(l.data+0x3626,true),vsync:v.getUint16(l.data+0x267a,true),bomb:{active:h[l.data+0x4206],frame:h[l.data+0x4207]},
   guests:[Array.from(h.slice(l.code+patch.mailbox_cs_offset+40,l.code+patch.mailbox_cs_offset+82)),Array.from(h.slice(l.code+patch.entry_map.p3_state,l.code+patch.entry_map.p3_state+42))],
   seats:nativePlayers(h,l.code+patch.mailbox_cs_offset,patch).positions,
   queued:[v.getUint16(l.data+0x3064,true),v.getUint16(l.code+patch.mailbox_cs_offset+22,true),v.getUint16(l.code+patch.entry_map.p3_input,true)],
   ...(stageSamples.length>=119&&stageSamples.length<=122?{shotDump:Array.from(h.slice(l.data+0xba8e,l.data+0xba8e+64*18))}:{}),
   personal:Array.from(h.slice(l.code+patch.personal_stats.cs_offset,l.code+patch.personal_stats.cs_offset+96))});
 }
}
const stageDispatch=onmessage;
onmessage=async event=>{try{
 const d=event.data;
 if(d.type==='stage-probe'){
  if(d.action==='jump'){
   const h=mod.HEAPU8,v=new DataView(h.buffer),data=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
   const r=guestBase+v.getUint16(data+0x41fe,true)*16+v.getUint16(data+0x41fc,true);
   stageRestore=d.restore||null;h[r+0x13]=d.stage;h[data+0x576c]=2;stageSamples=[];stagePattern=!!d.pattern;stageCurrentPair=null;stageRings=[];stageDebug={};stageDebugEnabled=!!d.debug;stageInputs=[];stagePlayback=d.inputs||null;
  }
  if(d.action==='run')for(let n=0;n<d.count;n++){
   if(stagePlayback&&stageSamples.length>=stagePlayback.length)break;
   advance(stageCurrentPair||Array.from({length:mod.HEAPU8[mailbox-patch.mailbox_cs_offset+patch.entry_map.player_count]},()=>d.keys||0),false,0);confirm(frame);
   if(n%16===15)await yieldHost();
  }
  send('stage-probe-result',{state:state(),captured:stageCaptured,samples:stageSamples,markers:stageMarkers,rings:stageRings,inputs:stageInputs,...(d.debug?{debug:stageDebug}:{})});return;
 }
 return stageDispatch(event);
}catch(error){fail(error);}};
