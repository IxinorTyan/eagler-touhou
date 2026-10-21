// Shared TH04 runtime, with serial native operations and page-owned audio.
const send=(message,transfer=[])=>postMessage(message,transfer);
const audioContext={sampleRate:44100,state:'running',currentTime:0,
 addEventListener(){},removeEventListener(){},resume:async()=>{},close:async()=>{}};
let ready,stopped=false,loaded=false,frameSequence=0,sequence=0,played=0,replayMusic;
const transfers=new Set();
globalThis.th04WorkerHost={canvas:new OffscreenCanvas(640,400),audioContext,
 captureAudioState:()=>({sequence,played,music:replayMusic.capture()}),restoreAudioState(saved){const events=replayMusic.restore(saved?.music);sequence=saved.sequence;played=saved.played;send({type:'replay-audio-reset',events,sequence});},
 notify:message=>{
  if(message.event==='runtime-error')try{message.fault=th04WorkerHost.runtime?.faultReport();}catch{/* Preserve the original failure. */}
  send({type:'notify',message});
 },music:event=>{replayMusic?.observe(event);send({type:'music',event});},
 se:{load:async()=>{},confirm(event){
  const count=(event.sequence-sequence)&65535;
  if(count>8)throw Error('音效事件超过桥接队列容量');
  for(let i=0;i<count;i++){const id=event.ring[(sequence+i)&7];if(!Number.isInteger(id)||id<0||id>=17)throw Error('原生音效编号无效');}
  sequence=event.sequence;played+=count;send({type:'se',event});
 },stop:()=>send({type:'se-stop'}),dispose(){},
 info:()=>({sequence,played,status:'浏览器音效：确认事件交给页面',loaded:17})}
};
function status(){const r=th04WorkerHost.runtime;return {game:r.snapshot(),proof:r.replayProof(),ready:r.readyForRollback(),reason:r.predictionBlockReason(),
 touch:r.touchContext(),rollback:r.rollbackInfo(),render:r.renderInfo(),diagnostics:r.diagnosticText(),fault:r.faultReport({cpu:false})};}
function present(){
 if(transfers.size>=2)return false;
 if(!th04WorkerHost.runtime.present())return false;
 const bitmap=th04WorkerHost.canvas.transferToImageBitmap(),sequence=++frameSequence;
 transfers.add(sequence);send({type:'frame',bitmap,sequence},[bitmap]);return true;
}
let chain=Promise.resolve();
onmessage=({data})=>{
 if(data.type==='frame-ack'){transfers.delete(data.sequence);return;}
 chain=chain.then(async()=>{
  if(stopped)return;
  if(!ready)ready=import('./runtime.js');await ready;
  const r=th04WorkerHost.runtime,started=performance.now();let result;
  if(data.type==='load'){if(loaded)throw Error('运行实例不能重新加载或更改旁观身份');loaded=true;th04WorkerHost.replayOnly=data.spectator===true;if(th04WorkerHost.replayOnly)replayMusic=(await import('../replay/music-state.js')).createMusicState();r.configure(...data.configure);result=await r.load(data.settings);}
  else if(data.type==='execute'){
   if(data.capture)r.capture(data.frame);
   r.step(data.inputs,{frame:data.frame,replay:data.replay,offlineMask:data.offlineMask});
   if(data.hash)result=r.checksum();
  }else if(data.type==='present')result=present();
  else if(data.type==='stop'){stopped=true;r.stop();return;}
  else {if(typeof r[data.type]!=='function')throw Error('Unknown TH04 worker command');result=await r[data.type](...data.args);}
  send({type:'result',id:data.id,result,status:status(),executionMs:performance.now()-started});
 }).catch(error=>{
  stopped=true;let fault;try{fault=th04WorkerHost.runtime?.faultReport();}catch{/* Preserve the command failure. */}
  send({type:'error',id:data.id,message:error.stack||String(error),fault});
 });
};
