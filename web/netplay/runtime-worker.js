// Same native runtime and complete checkpoints, with page-owned input/audio.
const send=(message,transfer=[])=>postMessage(message,transfer);
const audioContext={sampleRate:44100,state:'running',currentTime:0,addEventListener(){},removeEventListener(){},resume:async()=>{},close:async()=>{}};
let ready,stopped=false,frameSequence=0;
const transfers=new Set();
const metrics={captureMs:0,captures:0,stepMs:0,steps:0,replaySteps:0,restoreMs:0,restores:0,confirmMs:0,confirmations:0,hashMs:0,hashes:0,presentMs:0,presentations:0,bitmapMs:0,bitmaps:0,nativeMs:0,nativeSteps:0,nativeMaxMs:0,statusMs:0,queueMs:0,commands:0};
const slowSteps=[];let detailAt=-Infinity;
function timed(kind,count,action){const at=performance.now();try{return action();}finally{metrics[kind]+=performance.now()-at;metrics[count]++;}}
globalThis.th02WorkerHost={canvas:new OffscreenCanvas(640,400),audioContext,
 recordNative(costMs,frame,replay){metrics.nativeMs+=costMs;metrics.nativeSteps++;metrics.nativeMaxMs=Math.max(metrics.nativeMaxMs,costMs);if(costMs>30){slowSteps.push({frame,replay,costMs});if(slowSteps.length>120)slowSteps.shift();}},
 notify:message=>send({type:'notify',message}),music:event=>send({type:'music',event}),
 sfx:{load:async()=>{},play:id=>send({type:'sfx',id}),stop(){},dispose(){},info:()=>({ready:true,mode:'confirmed-worker-events'})}
};
function status(){const at=performance.now(),r=th02WorkerHost.runtime;
 const value={game:r.snapshot(),ready:r.readyForRollback(),reason:r.predictionBlockReason(),touch:r.touchContext(),rollback:r.rollbackInfo()};
 // Expensive display percentile sorting and fault detail are observational;
 // keep them out of every step/confirm RPC, while game policy stays current.
 if(at-detailAt>=250){detailAt=at;Object.assign(value,{render:r.renderInfo(),diagnostics:r.diagnosticText(),fault:r.faultReport(),slowSteps:slowSteps.slice()});}
 metrics.statusMs+=performance.now()-at;value.performance={...metrics};return value;
}
function present(){
 if(transfers.size>=2)return false;
 if(!timed('presentMs','presentations',()=>th02WorkerHost.runtime.present()))return false;
 const bitmap=timed('bitmapMs','bitmaps',()=>th02WorkerHost.canvas.transferToImageBitmap()),sequence=++frameSequence;
 transfers.add(sequence);send({type:'frame',bitmap,sequence},[bitmap]);return true;
}
let chain=Promise.resolve();
onmessage=({data})=>{
 if(data.type==='frame-ack'){transfers.delete(data.sequence);return;}
 const receivedAt=performance.now();
 chain=chain.then(async()=>{
  if(stopped)return;
  if(!ready)ready=import('./runtime.js');await ready;
  const r=th02WorkerHost.runtime,started=performance.now();metrics.queueMs+=started-receivedAt;metrics.commands++;let result;
  if(data.type==='load'){r.configure(...data.configure);result=await r.load(data.settings);}
  else if(data.type==='execute'){
   if(data.capture)timed('captureMs','captures',()=>r.capture(data.frame));
   timed('stepMs','steps',()=>r.step(data.inputs,{frame:data.frame,replay:data.replay,offlineMask:data.offlineMask}));if(data.replay)metrics.replaySteps++;
   if(data.hash)result=timed('hashMs','hashes',()=>r.checksum());
  }else if(data.type==='present')result=present();
  else if(data.type==='stop'){stopped=true;r.stop();return;}
  else {if(typeof r[data.type]!=='function')throw Error('Unknown TH02 worker command');
   const kinds={capture:['captureMs','captures'],step:['stepMs','steps'],restore:['restoreMs','restores'],confirm:['confirmMs','confirmations'],checksum:['hashMs','hashes']},kind=kinds[data.type];
   result=kind?timed(...kind,()=>r[data.type](...data.args)):await r[data.type](...data.args);
   if(data.type==='step'&&data.args[1]?.replay)metrics.replaySteps++;
  }
  send({type:'result',id:data.id,result,status:status(),executionMs:performance.now()-started});
 }).catch(error=>send({type:'error',id:data.id,message:error.stack||String(error)}));
};
