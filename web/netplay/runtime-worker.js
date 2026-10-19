// Same native runtime and complete checkpoints, with page-owned input/audio.
const send=(message,transfer=[])=>postMessage(message,transfer);
const audioContext={sampleRate:44100,state:'running',currentTime:0,addEventListener(){},removeEventListener(){},resume:async()=>{},close:async()=>{}};
let ready,stopped=false,frameSequence=0;
const transfers=new Set();
globalThis.th02WorkerHost={canvas:new OffscreenCanvas(640,400),audioContext,
 notify:message=>send({type:'notify',message}),music:event=>send({type:'music',event}),
 sfx:{load:async()=>{},play:id=>send({type:'sfx',id}),stop(){},dispose(){},info:()=>({ready:true,mode:'confirmed-worker-events'})}
};
function status(){const r=th02WorkerHost.runtime;return {game:r.snapshot(),ready:r.readyForRollback(),reason:r.predictionBlockReason(),touch:r.touchContext(),rollback:r.rollbackInfo(),render:r.renderInfo(),diagnostics:r.diagnosticText(),fault:r.faultReport()};}
function present(){
 if(transfers.size>=2)return false;
 if(!th02WorkerHost.runtime.present())return false;
 const bitmap=th02WorkerHost.canvas.transferToImageBitmap(),sequence=++frameSequence;
 transfers.add(sequence);send({type:'frame',bitmap,sequence},[bitmap]);return true;
}
let chain=Promise.resolve();
onmessage=({data})=>{
 if(data.type==='frame-ack'){transfers.delete(data.sequence);return;}
 chain=chain.then(async()=>{
  if(stopped)return;
  if(!ready)ready=import('./runtime.js');await ready;
  const r=th02WorkerHost.runtime,started=performance.now();let result;
  if(data.type==='load'){r.configure(...data.configure);result=await r.load(data.settings);}
  else if(data.type==='execute'){
   if(data.capture)r.capture(data.frame);
   r.step(data.inputs,{frame:data.frame,replay:data.replay,offlineMask:data.offlineMask});
   if(data.hash)result=r.checksum();
  }else if(data.type==='present')result=present();
  else if(data.type==='stop'){stopped=true;r.stop();return;}
  else {if(typeof r[data.type]!=='function')throw Error('Unknown TH02 worker command');result=await r[data.type](...data.args);}
  send({type:'result',id:data.id,result,status:status(),executionMs:performance.now()-started});
 }).catch(error=>send({type:'error',id:data.id,message:error.stack||String(error)}));
};
