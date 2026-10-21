import {workerEnvironment} from '../solo-worker-environment.js';
import {NetworkSimulation} from './simulation.js';
import {bootToSelection} from '../dosbox-boot.js';
let emulator,simulation,canvas,failed=false,sequence=0,diagnosticsAt=-Infinity;
const transfers=new Set();let events=[];
const send=(message,transfer=[])=>postMessage(message,transfer);
function status(){
  const now=performance.now(),diagnostics=now-diagnosticsAt>=1000;
  // Long diagnostic arrays are useful in reports, but copying them sixty
  // times per second needlessly adds work to the page and the message port.
  if(diagnostics)diagnosticsAt=now;
  return simulation.describe({diagnostics});
}
async function dispatch(method,args){
  if(method==='init'){
    const setup=args[0];canvas=new OffscreenCanvas(640,400);workerEnvironment(canvas,setup.sampleRate);
    const {DOSBoxPC98}=await import('../dosbox-adapter.js');
    emulator=await DOSBoxPC98.create({...setup.config,canvas,workerRuntime:true,lockstep:true,independentSfx:true,
      onError:error=>{failed=true;send({type:'fatal',message:error.message});},onExit:()=>send({type:'exit'})});
    simulation=new NetworkSimulation(emulator,setup.bridge,event=>events.push(event));
    return {runtime:emulator.module.mobileRuntime};
  }
  if(!simulation)throw Error('联机模拟线程尚未初始化');
  if(method==='addDiskImage'){emulator.addDiskImage(...args);return;}
  if(method==='setHdd')return emulator.setHdd(...args);
  if(method==='getDiskImage')return emulator.getDiskImage(...args);
  if(method==='boot'){
    const bootMusic=await bootToSelection({emulator,pause:simulation.pause,music:simulation.music,
      progress:message=>send({type:'progress',message})});
    return {events:bootMusic,hash:simulation.hash()};
  }
  if(method==='execute'){
    const [inputs,options]=args;let captureMs=0,hashMs=0,hash;
    if(options.capture){const at=performance.now();simulation.capture(options.frame);captureMs=performance.now()-at;}
    const at=performance.now();simulation.step(inputs,options.frame,options.replay);const simulateMs=performance.now()-at;
    if(options.hash){const at=performance.now();hash=simulation.hash();hashMs=performance.now()-at;}
    return {hash,captureMs,hashMs,simulateMs,proof:simulation.proof()};
  }
  if(method==='restore')return simulation.restore(...args);
  if(method==='confirm'){simulation.confirm(...args);return;}
  if(method==='hash')return simulation.hash();
  if(method==='run'){emulator.run();return;}
  if(method==='pause'){emulator.pause();return;}
  if(method==='present'){
    if(transfers.size>=2||!emulator.module.netPresent())return false;
    const bitmap=canvas.transferToImageBitmap(),id=++sequence;transfers.add(id);
    send({type:'frame',sequence:id,bitmap},[bitmap]);return true;
  }
  throw Error('未知联机线程指令：'+method);
}
let chain=Promise.resolve();
onmessage=({data})=>{
  if(data?.type==='frame-ack'){transfers.delete(data.sequence);return;}
  // DOSBox posts private scheduling messages on this scope as well.
  if(!data?.id||typeof data.method!=='string')return;
  chain=chain.then(async()=>{
    if(failed){send({type:'error',id:data.id,message:'联机模拟线程已失败'});return;}
    try{
      const at=performance.now(),result=await dispatch(data.method,data.args||[]);
      const audio=events;events=[];
      send({type:'reply',id:data.id,result,status:simulation?status():null,events:audio,executionMs:performance.now()-at},result instanceof Uint8Array?[result.buffer]:[]);
    }catch(error){failed=true;send({type:'error',id:data.id,message:error.stack||String(error)});}
  });
};
addEventListener('error',event=>{failed=true;send({type:'fatal',message:event.message});});
addEventListener('unhandledrejection',event=>{failed=true;send({type:'fatal',message:String(event.reason?.stack||event.reason)});});
