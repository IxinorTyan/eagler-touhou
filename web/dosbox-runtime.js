import {gameFiles} from './disk-files.js';
import {createFrameDisplay} from './frame-display.js';
import {LocalAudioOutput} from './netplay/audio-output.js';
import {installMusicFiles,loadMusicAssets} from './music-files.js';
import {loadCompiledCore,loadVerifiedBytes} from './startup-assets.js';
import {LocalBgm} from './netplay/local-bgm.js';
export async function prepareFastCore(practice=false){
  if(typeof WebAssembly.Suspending!=='function'||typeof WebAssembly.promising!=='function')throw Error('此性能版需要支持 JSPI 的新版 Chrome / Edge 浏览器。');
  if(practice){const response=await fetch(new URL('practice-core.json',import.meta.url),{cache:'no-store'});if(!response.ok)throw Error('练习核心清单读取失败');const m=await response.json();return loadCompiledCore(new URL(m.url,import.meta.url),m.sha256);}
  const vendor=new URL('vendor/dosbox-x/',import.meta.url),response=await fetch(new URL('runtime.json',vendor),{cache:'no-store'});
  if(!response.ok)throw Error('模拟器核心清单读取失败');
  const manifest=await response.json();
  return loadCompiledCore(new URL('wdosbox-x-fast.wasm',vendor),manifest.files['wdosbox-x-fast.wasm']);
}
export async function createFastCore({canvas,disk,patch,qa=false,core='simple',cycles,presentation='bitmap',viewSlot=0,solo=false,independentMusic=true,coreTask,externalReplay,frameReplay,practice,practiceExe}){
  // DOSBox's automatic cycle controller assumes a real wall clock. A scaled
  // practice clock otherwise drives it down to 200 cycles and stalls the guest.
  const targeted=!!practice&&practice.mode!=='full';
  cycles??=practice?'16000':'max 100%';
  if(practice&&(!solo||frameReplay||!patch.practice))throw Error('练习功能需要单人练习资源');
  if(frameReplay&&frameReplay.mode!=='playback'&&!qa)throw Error('旧单人 Replay 仅允许播放，录制请使用浏览器方案');
  if(externalReplay&&!['record','playback'].includes(externalReplay.mode))throw Error('无效的浏览器 Replay 模式');
  if(typeof WebAssembly.Suspending!=='function'||typeof WebAssembly.promising!=='function')throw Error('此性能版需要支持 JSPI 的新版 Chrome / Edge 浏览器。');
  if(typeof OffscreenCanvas!=='function')throw Error('此性能版需要支持后台画布的浏览器。');
  const mode=qa&&['direct','upstream'].includes(presentation)?presentation:'bitmap';
  const compiledTask=coreTask||prepareFastCore(!!practice),musicTask=independentMusic?loadMusicAssets():Promise.resolve(null);
  compiledTask.catch(()=>{});musicTask.catch(()=>{});
  let latest=null,resolveReady,rejectReady,stopped=false,practiceMuted=targeted;
  const worker=new Worker(new URL('./dosbox-worker.js',import.meta.url));
  const ready=new Promise((a,b)=>{resolveReady=a;rejectReady=b;});
  const api={state:'starting',config:{core:'dosbox-x',cpuCore:core,cycles},onError:null,onExit:null,
    readState:()=>latest?{...latest,...(display?{presentation:{...display.metrics}}:{})}:null,key:(code,down)=>worker.postMessage({type:'key',code,down}),
    inputs:input=>worker.postMessage({type:'input',input}),
    practiceOptions:options=>worker.postMessage({type:'practice-options',options}),
    onPracticeRetry:null,
    onPracticeComplete:null,
    viewSlot:slot=>worker.postMessage({type:'view-slot',slot}),
    gamePause:({onlyPause=false}={})=>worker.postMessage({type:'game-pause',onlyPause}),
    finishReplay:()=>worker.postMessage({type:'external-replay-finish'}),
    stopBrowserRecording:()=>worker.postMessage({type:'external-replay-disable'}),
    setReplayCheat:value=>worker.postMessage({type:'frame-replay-cheat',value}),
    stopReplayRecording:()=>worker.postMessage({type:'frame-replay-stop-recording'}),
    pauseReplay:value=>{worker.postMessage({type:'external-replay-pause',value});api.state=value?'paused':'running';api.bgm?.setPaused(value);if(value){api.audioOutput?.flush();api.audio?.suspend();}else api.audio?.resume();},
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
    if(data.type==='state'){latest=data.state;if(practiceMuted&&latest.practice?.ready&&!latest.practice.waiting){practiceMuted=false;api.bgm?.setPaused(false);if(api.state==='running')api.audio?.resume();}worker.postMessage({type:'ack'});}
    if(data.type==='external-replay-chunk')externalReplay?.onChunk?.(data);
    if(data.type==='external-replay-run')externalReplay?.onRun?.(data.run);
    if(data.type==='external-replay-end')externalReplay?.onEnd?.(data.result);
    if(data.type==='external-replay-recording-error')externalReplay?.onRecordingError?.(Error(data.message));
    if(data.type==='practice-retry')api.onPracticeRetry?.();
    if(data.type==='practice-complete')api.onPracticeComplete?.(data.outcome);
    if(data.type==='frame-replay-taint')frameReplay?.onTaint?.();
    if(data.type==='frame-replay-run')frameReplay?.onRun?.(data.run);
    if(data.type==='frame-replay-dialog')frameReplay?.onDialog?.(data.active);
    if(data.type==='frame-replay-phase')frameReplay?.onPhase?.(data);
    if(data.type==='frame-replay-chunk')frameReplay?.onChunk?.(data.inputs);
    if(data.type==='frame-replay-end')frameReplay?.onEnd?.(data.result);
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
    if(practiceMuted)await api.audio.suspend();else await api.audio.resume();
    if(independentMusic){api.bgm=new LocalBgm(api.audio,()=>{});if(practiceMuted)api.bgm.setPaused(true);api.bgm.load({warmOpening:false}).catch(e=>{api.musicError=e.message;});}
  }catch(e){api.stop();throw Error('声音初始化失败：'+e.message);}
  let files,musicPatch;
  let compiledCore;
  try{
    files=gameFiles(disk,{solo});if(practice){if(!(practiceExe instanceof Uint8Array))throw Error('练习程序缺失');files.find(f=>f.path==='game/KAIKI/MAIN.EXE').contents=practiceExe;
    }
    if(targeted){const response=await fetch(new URL('practice-assets.json',import.meta.url),{cache:'no-store'});if(!response.ok)throw Error('练习启动程序清单读取失败');
      const spec=(await response.json()).launcher,launcher=(await loadVerifiedBytes(new URL(spec.url,import.meta.url),spec.sha256,{size:spec.size})).slice();
      const signature=new TextEncoder().encode(spec.signature);let at=-1;for(let i=0;i<=launcher.length-signature.length;i++)if(signature.every((b,n)=>launcher[i+n]===b)){at=i+signature.length;break;}
      if(at<0)throw Error('练习启动程序配置缺失');launcher[at+1]=practice.setup.difficulty;launcher[at+2]=practice.setup.character;launcher[at+3]=practice.setup.lives+1;launcher[at+4]=practice.setup.bombs;
      files.push({path:'game/KAIKI/PRACTICE.COM',contents:launcher});
      const batch=files.find(f=>f.path==='game/KAIKI/FAST.BAT');batch.contents=new TextEncoder().encode(new TextDecoder().decode(batch.contents).replace('\r\nop\r\n','\r\npractice\r\nif errorlevel 1 goto fin\r\nmain\r\n'));
}
    if(frameReplay){files.find(f=>f.path==='game/KAIKI/MAIN.EXE').contents=frameReplay.exe;files.find(f=>f.path==='game/KAIKI/MAINE.EXE').contents=frameReplay.endingExe;}
    const assets=await musicTask;
    if(independentMusic)musicPatch=await installMusicFiles(files,{solo:solo&&!targeted,assets});
    compiledCore=await compiledTask;
  }catch(e){api.stop();throw e;}
  const offscreen=mode==='bitmap'?new OffscreenCanvas(canvas.width,canvas.height):canvas.transferControlToOffscreen(),transfer=[offscreen,audioPort,...files.map(f=>f.contents.buffer)];
  const replayConfig=externalReplay?{mode:externalReplay.mode,clocks:externalReplay.clocks,events:externalReplay.events,endBoundary:externalReplay.endBoundary}:null;
  if(replayConfig?.clocks)transfer.push(replayConfig.clocks.buffer);
  const frameConfig=frameReplay?{mode:frameReplay.mode,header:frameReplay.header,inputs:frameReplay.inputs}:null;
  if(frameConfig?.inputs)transfer.push(frameConfig.inputs.buffer);
  worker.postMessage({type:'boot',base:new URL('.',import.meta.url).href,canvas:offscreen,audioPort,files,patch,musicPatch,compiledCore,core,cycles,qa,presentation:mode,presentationActive:!document.hidden,viewSlot,solo,externalReplay:replayConfig,frameReplay:frameConfig,practice},transfer);
  const timeout=setTimeout(()=>rejectReady(Error('PC-98 核心初始化超时')),30000);
  try{await ready;return api;}catch(e){api.stop();throw e;}finally{clearTimeout(timeout);}
}
