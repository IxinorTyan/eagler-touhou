import {gameFiles} from './disk-files.js';
import {createFrameDisplay} from './frame-display.js';
import {LocalAudioOutput} from './netplay/audio-output.js';
import {installMusicFiles,loadMusicAssets} from './music-files.js';
import {loadCompiledCore} from './startup-assets.js';
import {LocalBgm} from './netplay/local-bgm.js';
export async function prepareFastCore(){
  if(typeof WebAssembly.Suspending!=='function'||typeof WebAssembly.promising!=='function')throw Error('此性能版需要支持 JSPI 的新版 Chrome / Edge 浏览器。');
  const vendor=new URL('vendor/dosbox-x/',import.meta.url),response=await fetch(new URL('runtime.json',vendor),{cache:'no-store'});
  if(!response.ok)throw Error('模拟器核心清单读取失败');
  const manifest=await response.json();
  return loadCompiledCore(new URL('wdosbox-x-fast.wasm',vendor),manifest.files['wdosbox-x-fast.wasm']);
}
export async function createFastCore({canvas,disk,patch,qa=false,core='simple',cycles='max 100%',presentation='bitmap',viewSlot=0,solo=false,independentMusic=true,coreTask}){
  if(typeof WebAssembly.Suspending!=='function'||typeof WebAssembly.promising!=='function')throw Error('此性能版需要支持 JSPI 的新版 Chrome / Edge 浏览器。');
  if(typeof OffscreenCanvas!=='function')throw Error('此性能版需要支持后台画布的浏览器。');
  const mode=qa&&['direct','upstream'].includes(presentation)?presentation:'bitmap';
  const compiledTask=coreTask||prepareFastCore(),musicTask=independentMusic?loadMusicAssets():Promise.resolve(null);
  compiledTask.catch(()=>{});musicTask.catch(()=>{});
  let latest=null,resolveReady,rejectReady,stopped=false;
  const worker=new Worker(new URL('./dosbox-worker.js',import.meta.url));
  const ready=new Promise((a,b)=>{resolveReady=a;rejectReady=b;});
  const api={state:'starting',config:{core:'dosbox-x',cpuCore:core,cycles},onError:null,onExit:null,
    readState:()=>latest?{...latest,...(display?{presentation:{...display.metrics}}:{})}:null,key:(code,down)=>worker.postMessage({type:'key',code,down}),
    inputs:input=>worker.postMessage({type:'input',input}),
    viewSlot:slot=>worker.postMessage({type:'view-slot',slot}),
    gamePause:({onlyPause=false}={})=>worker.postMessage({type:'game-pause',onlyPause}),
    pause(){api.state='paused';worker.postMessage({type:'pause'});api.audioOutput?.flush();api.audio?.suspend();},
    run(){api.state='running';worker.postMessage({type:'resume'});api.audio?.resume();},
    stop(){if(stopped)return;stopped=true;display?.stop();document.removeEventListener('visibilitychange',visibility);worker.terminate();api.bgm?.dispose();api.audioOutput?.disconnect();api.audioInput?.close();api.audioNode?.disconnect();api.audio?.close();api.state='stopped';for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('游戏已停止'));}pending.clear();},
    capture(){if(display)return display.capture();const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('画面保存超时'));},10000);pending.set(id,{resolve,reject,timer});worker.postMessage({type:'capture',id});});},
    async qa(action,props={}){if(!qa)throw Error('QA 未开启');const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('QA 超时'));},10000);pending.set(id,{resolve,reject,timer});worker.postMessage({type:'qa',enabled:qa,id,action,...props});});},
  };
  let serial=0;const pending=new Map();
  let display;
  const fail=error=>{if(stopped)return;api.stop();api.state='failed';rejectReady(error);api.onError?.(error);};
  function visibility(){if(!display)return;if(document.hidden)display.clear();worker.postMessage({type:'presentation-active',value:!document.hidden});}
  try{if(mode==='bitmap')display=createFrameDisplay(canvas,{release:(seq,presented)=>worker.postMessage({type:'frame-ack',seq,presented}),onError:fail});}catch(e){worker.terminate();throw e;}
  document.addEventListener('visibilitychange',visibility);
  worker.onerror=e=>fail(Error(e.message));
  worker.onmessage=({data})=>{
    if(stopped){data.bitmap?.close();return;}
    if(data.name==='ws-sync-sleep'){worker.postMessage({name:'wc-sync-sleep',props:data.props});return;}
    if(data.type==='frame'){if(display)display.receive(data);else data.bitmap.close();return;}
    if(data.type==='ready'){api.state='running';resolveReady();}
    if(data.type==='game-exit'){api.stop();api.onExit?.();return;}
    if(data.type==='music'){for(const [ax,hash]of data.events)api.bgm?.command(ax,hash);}
    if(data.type==='state'){latest=data.state;worker.postMessage({type:'ack'});}
    if(data.type==='error'){fail(Error(data.message));return;}
    if(data.type==='qa-result'){const p=pending.get(data.id);if(p){clearTimeout(p.timer);pending.delete(data.id);p.resolve(data);}}
    if(data.type==='capture'){const p=pending.get(data.id);if(p){clearTimeout(p.timer);pending.delete(data.id);p.resolve(data.blob);}}
  };
  let audioPort;
  try{
    api.audio=new AudioContext({sampleRate:44100,latencyHint:'interactive'});
    if(api.audio.audioWorklet&&typeof AudioWorkletNode==='function'){
      await api.audio.audioWorklet.addModule(new URL('./vendor/dosbox-x/audio-worklet.js',import.meta.url));
      api.audioNode=new AudioWorkletNode(api.audio,'jsdos-audio',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
      api.audioNode.connect(api.audio.destination);audioPort=api.audioNode.port;api.audioMode='worklet';
    }else{
      const bridge=new MessageChannel();api.audioInput=bridge.port1;audioPort=bridge.port2;
      api.audioOutput=new LocalAudioOutput(api.audio,1);api.audioMode='buffer';
      api.audioInput.onmessage=({data})=>{
        if(data instanceof Float32Array&&api.state==='running')api.audioOutput.push([data]);
        else if(data?.type==='init'&&data.sourceRate!==44100)fail(Error('不支持的原声音频采样率'));
      };
    }
    await api.audio.resume();
    if(independentMusic){api.bgm=new LocalBgm(api.audio,()=>{});api.bgm.load({warmOpening:false}).catch(e=>{api.musicError=e.message;});}
  }catch(e){api.stop();throw Error('声音初始化失败：'+e.message);}
  let files,musicPatch;
  let compiledCore;
  try{
    files=gameFiles(disk,{solo});const assets=await musicTask;
    if(independentMusic)musicPatch=await installMusicFiles(files,{solo,assets});
    compiledCore=await compiledTask;
  }catch(e){api.stop();throw e;}
  const offscreen=mode==='bitmap'?new OffscreenCanvas(canvas.width,canvas.height):canvas.transferControlToOffscreen(),transfer=[offscreen,audioPort,...files.map(f=>f.contents.buffer)];
  worker.postMessage({type:'boot',base:new URL('.',import.meta.url).href,canvas:offscreen,audioPort,files,patch,musicPatch,compiledCore,core,cycles,qa,presentation:mode,presentationActive:!document.hidden,viewSlot,solo},transfer);
  const timeout=setTimeout(()=>rejectReady(Error('PC-98 核心初始化超时')),30000);
  try{await ready;return api;}catch(e){api.stop();throw e;}finally{clearTimeout(timeout);}
}
