// Test-only commands; recording/playback use the unmodified production worker.
allowStageProbeAssets=true;
import {packTouch as watchPackTouch} from '/touch-input.js';
import {stageLayout as watchLayout} from '/netplay/stage-stream.js';
let watchFailure=null,watchProofs=[],watchProofIndex=0,watchDiagnostics=false;
function watchProofBytes(packed){
 const l=watchLayout(mod,patch,packed),d=l.data,c=l.code,m=c+patch.mailbox_cs_offset,e=patch.entry_map;
 return Object.fromEntries([['rng',d+0x418,4],['p1',d+0x36d0,40],['stocks',d+0x4ad4,4],['settings',d+0x5764,20],['ring',d+0x3526,258],['spark',d+0x41dc,2],['ticks',m+16,4],['p2',m+40,50],['p3',c+e.p3_state,50],['stats',c+e.personal_stats,96],['out',c+e.out_flags,3]].map(([name,at,size])=>[name,Array.from(mod.HEAPU8.subarray(at,at+size))]));
}
let forceCaptureFault=false;
let dialogFixture=false,dialogUpdates=0,dialogInjected=false,dialogReturned=false,dialogStub=-1;
const nativeStageMarker=observeNativeStage;
observeNativeStage=(port,packed)=>{
 if(forceCaptureFault&&captureStages&&effect&&port===0x7fe4){effect.stageEvents.length=512;forceCaptureFault=false;}
 if(port===0x7fe0){watchProofs=[];watchProofIndex=0;}
 const diagnostic=port===0x7fe2?{index:watchProofIndex++,frame,...(watchDiagnostics?{bytes:watchProofBytes(packed)}:{})}:null;
 if(diagnostic&&watchDiagnostics&&watchProofs.length<4096)watchProofs.push(diagnostic);
 try{nativeStageMarker(port,packed);}catch(error){if(diagnostic&&!diagnostic.bytes)diagnostic.bytes=watchProofBytes(packed);watchFailure={message:error.message,event:stagePlayer?stagePlayer.offset+stagePlayer.cursor:null,diagnostic};throw error;}
 if(!dialogFixture||port!==0x7fe2)return;
 const origin=mod.nativeExports().thCoreState(0),c=origin+(packed&65535)*16,d=origin+(packed>>>16)*16,h=mod.HEAPU8,v=new DataView(h.buffer);
 if(dialogInjected){if(v.getUint16(d+0xc656,true)!==dialogStub)dialogReturned=true;return;}
 if(++dialogUpdates!==180)return;
 const stub=0x9ca0+patch.payload_bytes,call=(0x13e58-0xae10-stub-4)&65535,old=v.getUint16(d+0xc656,true);
 if(patch.insert_size-patch.payload_bytes<12)throw Error("QA stub padding unavailable");
 h.set([0x0e,0xe8,call&255,call>>>8,0xc7,0x06,0x56,0xc6,old&255,old>>>8,0xc3],c+stub);v.setUint16(d+0xc656,stub,true);dialogStub=stub;dialogInjected=true;
};
let watchEvents=[],watchBatches=[],watchTarget=-1,watchLastSlice=null,watchPauses=[];
const watchPost=globalThis.postMessage.bind(globalThis);
globalThis.postMessage=(message,transfer)=>{
 if(message.type==='error')message={...message,stageDiagnostic:watchFailure};
 if(message.type==='confirmed-history')watchBatches.push(structuredClone(message));
 if(message.type==='confirmed-history'&&message.stageFrames)for(const events of message.stageFrames)if(events)watchEvents.push(...events);
 if(message.type==='stage-sliced')watchLastSlice=message;
 if(message.type==='pause-state')watchPauses.push(message.paused);
 return watchPost(message,transfer);
};
const watchDispatch=onmessage;
onmessage=async event=>{try{
 const d=event.data;
 if(d.type!=='stage-probe')return watchDispatch(event);
 const runStart=performance.now(),runCosts=[];
 if(d.action==='fault')forceCaptureFault=true;
 if(d.action==='jump'){
  watchDiagnostics=!!d.diagnostics;
  watchTarget=d.stage;watchEvents=[];dialogFixture=!!d.dialog;dialogUpdates=0;dialogInjected=dialogReturned=false;
  if(d.events){
   await watchDispatch({data:{type:'stage-load',events:d.events.slice(0,128)}});
   for(let at=128;at<d.events.length;at+=128)await watchDispatch({data:{type:'stage-append',first:at,events:d.events.slice(at,at+128)}});
  }else{
   const h=mod.HEAPU8,v=new DataView(h.buffer),data=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
   const r=guestBase+v.getUint16(data+0x41fe,true)*16+v.getUint16(data+0x41fc,true);
   h[r+0x13]=d.stage;h[data+0x576c]=2;
  }
 }
 let completed=0;
 if(d.action==='run')while(completed<d.count){
  if(stagePlayer){
   await watchDispatch({data:{type:'stage-slice',steps:Math.min(32,d.count-completed),quiet:true}});
   if(fatal)return;
   completed+=watchLastSlice.applied;if(watchLastSlice.waiting)break;
  }else{
   const count=mod.HEAPU8[mailbox-patch.mailbox_cs_offset+patch.entry_map.player_count],n=completed;
   const pair=d.pattern?Array.from({length:count},(_,slot)=>32|((Math.floor(n/75)+slot)%2?4:8)|(n===300+slot*90?16:0)|(n%100<50?64:0)):Array(count).fill(d.keys||0);
   if(dialogFixture)pair[0]=n%40<20?32:0;
   if(d.controls){
    if(n>=220&&n<340)pair.fill(0);
    if(n===220)pair[0]=512;
    else if(n===280)pair[0]=1024;
    pair[1]=watchPackTouch(pair[1],{active:(n<220||n>=340)&&n%120<60,x:n%2?16:-16,y:n%3?8:-8});
   }
   if(d.offline&&n>=400)pair[1]=0;
   if(d.rollback&&n===204){
    const originalFrame=frame,wrong=pair.slice();wrong[1]^=16;
    advance(wrong,true,0);
    await watchDispatch({data:{type:'restore',frame:originalFrame}});
    if(fatal)return;
   }
   const stepStart=performance.now();advance(pair,false,d.offline&&n>=400?2:0);confirm(frame);runCosts.push(performance.now()-stepStart);completed++;
  }
  if(completed%16===0||stagePlayer)await yieldHost();
 }
 if(!stagePlayer)flushHistory();
 const at=watchEvents.findIndex(e=>e[0]===2&&e[1].stage===watchTarget);
 const ordered=runCosts.toSorted((a,b)=>a-b),costs=ordered.length?{steps:ordered.length,meanMs:runCosts.reduce((a,b)=>a+b,0)/ordered.length,p50Ms:ordered[Math.floor(ordered.length*.5)],p95Ms:ordered[Math.floor(ordered.length*.95)],maxMs:ordered.at(-1)}:null;
 send('stage-probe-result',{completed,runMs:performance.now()-runStart,costs,checksum:checksum(),captureStages,dialogInjected,dialogReturned,pauses:watchPauses,proofs:watchProofs,state:state(),batches:stagePlayer?undefined:watchBatches.map(b=>({...b,bytes:Array.from(b.bytes)})),events:stagePlayer?undefined:at<0?[]:watchEvents.slice(at),cursor:stagePlayer?stagePlayer.offset+stagePlayer.cursor:0,total:stagePlayer?stagePlayer.offset+stagePlayer.events.length:watchEvents.length});
}catch(error){fail(error);}};
