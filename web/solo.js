import {WorkerNP21,workerAssistBridge,mountWorkerChoice} from './solo-worker-client.js';
import {mountSoloView} from './solo-view.js';
import {SoloMusic} from './solo-music.js';
import {startFrameLoop} from './frame-limit.js';
import {mountSoloPerformance} from './solo-performance.js';
import {mountSoloFault} from './solo-fault.js';
import {mountSoloTestTools,readSoloDiagnostics,writeSoloTestCommand} from './solo-test-tools.js';
import {gameVersion,rememberLanguage} from './game-version.js';
// Standalone original game. No cooperative runtime, launcher or netplay session.
import {NP21} from './dosbox-adapter.js';
import {mountPlayer} from './player-ui.js';
import {mountFocusSettings} from './focus-settings.js';
import {mountControlSettings,keyboardBits,padBits,isBound,isFormTarget,controlsSummary,syntheticInputEvents} from './control-settings.js';
import {unpackTouch} from './touch-input.js';
import {sha256} from './netplay/sha256.js';
import {createBrowserSoloRecorder} from './replay/external-recorder.js';
import {decodeExternalReplay,restoreExternalReplayDisk} from './replay/external-codec.js';
import {fingerprint} from './replay/tape.js';
import {mountSoloReplayToolbar} from './replay/external-ui.js';
import {mountPractice} from './practice-ui.js';
import {normalizePractice} from './practice-config.js';
import {loadPracticeResources,installPractice} from './practice-assets.js';
const $=id=>document.getElementById(id);
const audioMode=$('audio-mode');
const runtimeMode=mountWorkerChoice(audioMode.closest('label').parentElement);
let soloMusic;
window.addEventListener('pagehide',event=>{if(event.persisted)soloMusic?.suspend();else soloMusic?.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted)soloMusic?.resume();});
try{const saved=localStorage.getItem('solo-audio-mode-v2');if(['independent','original','buffered'].includes(saved))audioMode.value=saved;}catch{}
audioMode.onchange=()=>{try{localStorage.setItem('solo-audio-mode-v2',audioMode.value);}catch{}};

rememberLanguage($('language'),'solo');
let emulator,patch,mailbox=-1,scanCursor=0,oldBits=0,focused=true,started=false,menuBits=0,menuUntil=0;
let recorder=null,recordBlob=null,loadedReplay=null,playback=false,lastAssist='';
let committedPractice=null,practiceCompleted=false,nativePauseTimer=null;
const keys=new Set(),seen=new Map();
const signature=new TextEncoder().encode('TH04SOLOINPUTv1!');
const replaySources=['../direct-drag.js','../player-ui.js','../solo.js','../solo-worker.js','../solo-worker-client.js','../dosbox-adapter.js','../game-version.js','../solo-native-music.js',
  '../touch-input.js','../vendor/dosbox-x/runtime.json','../vendor/dosbox-x/dosbox-jspi.mjs','../vendor/dosbox-x/wdosbox-x-fast.wasm',
  '../dosbox-disk.js','../frame-presenter.js','../solo-worker-environment.js','../solo-patch.json','../solo-patch-jp.json','../vendor/dosbox-x/emulators.js',
  './external-host.js','./external-loader.js','./external-codec.js','./external-recorder.js','./external-ui.js','./external-lifecycle.js',
  '../practice-config.js','../practice-engine.js','../practice-assets.js','../practice-assets.json','../practice-core.json','../practice-start.com','../practice-cn.exe.gz','../practice-jp.exe.gz','../vendor/dosbox-x/wdosbox-x-practice.wasm',
  '../solo-music.js','../solo-music.json','../solo-music.com','../bgm/manifest.json','../netplay/local-bgm.js'];
const setReplayStatus=text=>{$('replay-status').textContent=text;};
function clearRecording(){recorder?.dispose();recorder=null;recordBlob=null;$('record-save').disabled=true;$('record-discard').disabled=true;$('record-finish').disabled=true;replayUI.closeSave();}
const player=mountPlayer($('game'),{solo:true,onGesture:async()=>{soloMusic?.resume();await emulator?.module.SDL2?.audioContext?.resume();}});
let saveWasPaused=false;
const replayUI=mountSoloReplayToolbar($('game'),{isPlayback:()=>playback,isSynthetic:event=>syntheticInputEvents.has(event),
  onHold:()=>{saveWasPaused=emulator?.state==='paused';release();emulator?.pauseReplay(true);},
  onRelease:()=>{if(!saveWasPaused&&emulator&&emulator.state!=='exited')emulator.pauseReplay(false);canvas.focus();},
  onAgain:()=>{stopPlayback();startGame(loadedReplay);},onStop:()=>stopPlayback(),onFast:value=>emulator?.fastForwardReplay(value),
});
mountSoloView($('game'));
mountSoloFault({host:$('game'),getEmulator:()=>emulator,readState:readSoloState,readContext:()=>({language:$('language').value,audio:audioMode.value,status:$('status').textContent})});
mountSoloPerformance({host:$('game'),game:'04',getEmulator:()=>emulator,readState:()=>{
  const s=readSoloState();return s?{...s,playing:s.mode===1&&!s.flags}:null;
}});
const testTools=mountSoloTestTools({host:$('game'),readState:readSoloState,command:async value=>{
  if(playback||recorder)throw Error('Replay 录制或播放期间不能使用测试命令。请先丢弃录制。');
  const state=readSoloState();if(!state)throw Error('请先进入单机关卡。');
  const command={...value,generation:state.generation};
  if(emulator.isWorker)await emulator.call('soloTest',[command]);
  else writeSoloTestCommand(emulator.module.HEAPU8,mailbox,patch,command);
}});
const screen=document.createElement('div');screen.className='screen solo-screen';
let canvas=document.createElement('canvas');canvas.id='canvas';canvas.width=640;canvas.height=400;canvas.tabIndex=0;screen.append(canvas);player.stage.append(screen);
const practiceUI=mountPractice({host:$('game'),isSynthetic:e=>syntheticInputEvents.has(e),onRelease:release,onFocus:()=>canvas.focus(),
  onChange:options=>{if(!playback)emulator?.practiceOptions(options);},onStart:config=>restartPractice(config),
  onRetry:()=>{if(committedPractice?.mode==='target')restartPractice({...committedPractice,options:practiceUI.options});},
  onSave:()=>$('record-save').click(),onPause:()=>{release();if(readSoloState()?.mode===1){nativeKey('Escape',true);const until=performance.now()+3000;const check=()=>{if(readSoloState()?.mode===2||performance.now()>=until){nativeKey('Escape',false);nativePauseTimer=null;}else nativePauseTimer=setTimeout(check,30);};nativePauseTimer=setTimeout(check,30);}},
});
const practiceOpen=document.createElement('button');practiceOpen.type='button';practiceOpen.id='practice-open';practiceOpen.textContent='特定练习 · F12';$('start').after(practiceOpen);
practiceOpen.onclick=()=>{player.enter();practiceUI.open();};
// Return keyboard control after using the solo test/settings panel.
$('game').addEventListener('click',event=>{
  if(event.target.closest('[data-close],[data-save]')&&$('game').querySelector('.touch-layout-editor').hidden)canvas.focus();
});
const focus=mountFocusSettings($('control-settings'),{alwaysPointControl:player.alwaysPointControl,profile:'solo'});
const editor=mountControlSettings($('control-settings'),{solo:true,onEditing:()=>release(),onChange:()=>{release();summary();}});
function summary(){$('controls-summary').textContent=controlsSummary('solo');}summary();
const nativeActions=[['ArrowUp',1],['ArrowDown',2],['ArrowLeft',4],['ArrowRight',8],['KeyX',16],['KeyZ',32],['ShiftLeft',64],['Escape',128],['Enter',256]];
function nativeKey(code,down){
  if(!emulator)return;
  const keyCodes={KeyZ:90,KeyX:88,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Escape:27,ShiftLeft:16,Enter:13};
  const event=new KeyboardEvent(down?'keydown':'keyup',{code,key:({KeyZ:'z',KeyX:'x',ShiftLeft:'Shift'})[code]||code,keyCode:keyCodes[code],which:keyCodes[code],bubbles:true});
  syntheticInputEvents.add(event);canvas.dispatchEvent(event);
}
function send(bits){for(const [code,bit] of nativeActions)if((bits&bit)!==(oldBits&bit))nativeKey(code,!!(bits&bit));oldBits=bits;}
function applySoloAssist(value){
  if(!emulator)return;const at=Number.isInteger(value.address)?value.address:mailbox,h=emulator.module.HEAPU8;
  if(at<0||at+36>h.length||!signature.every((v,i)=>h[at+i]===v))return;
  const v=new DataView(h.buffer);
  if(Number.isInteger(value.generation)&&value.generation!==v.getUint16(at+24,true))return;
  h[at+26]=value.points||0;const t=value.touch;
  if(emulator.state==='running'&&h[at+22]===1&&!h[at+23]&&t?.active){
    if(t.begin)v.setInt32(at+30,0,true);
    v.setUint16(at+28,t.unlimited?3:1,true);
    for(const [offset,delta]of [[30,t.x],[32,t.y]])v.setInt16(at+offset,Math.max(-8192,Math.min(8191,v.getInt16(at+offset,true)+delta)),true);
  }else h.fill(0,at+28,at+36);
}
function clearNative(at=mailbox){
  if(playback||at<0||!emulator)return;
  if(emulator.isWorker){emulator.clearInput();return;}
  if(emulator.externalHost){const h=emulator.module.HEAPU8;emulator.assist({address:at,generation:new DataView(h.buffer).getUint16(at+24,true),points:0,touch:null});return;}
  const h=emulator.module.HEAPU8;if(signature.every((v,i)=>h[at+i]===v))h.fill(0,at+28,at+36);
}
function release(){if(nativePauseTimer!==null){clearTimeout(nativePauseTimer);nativePauseTimer=null;nativeKey('Escape',false);}menuBits=0;menuUntil=0;keys.clear();player.reset();send(0);clearNative();}
function scan(now){
  if(emulator.isWorker){mailbox=emulator.snapshot.state?.at??-1;return emulator.snapshot.state;}
  const h=emulator.module.HEAPU8,view=new DataView(h.buffer);
  const previous=mailbox;mailbox=-1;
  for(const [at,state] of seen){
    if(!signature.every((v,i)=>h[at+i]===v)){seen.delete(at);continue;}
    const ticks=view.getUint32(at+16,true);
    if(ticks!==state.ticks){state.ticks=ticks;state.changed=now;}
    // State 0 is explicitly published on world exit; a stale DOS allocation
    // must not turn title/ending touches into writes to the departed game.
    if((now-state.changed<200||h[at+22]===2)&&h[at+22]!==0)mailbox=at;
  }
  // Reuse validated live addresses. Search only while no live mailbox exists,
  // and bound each slice to 1 MiB so discovery cannot scan the whole WASM heap
  // in one animation frame. Overlap the boundary to catch split signatures.
  if(mailbox<0){
    if(scanCursor>=h.length)scanCursor=0;
    const end=Math.min(scanCursor+1024*1024,h.length);
    const slice=h.subarray(scanCursor,Math.min(end+35,h.length));
    for(let offset=slice.indexOf(signature[0]);offset>=0&&scanCursor+offset<end;offset=slice.indexOf(signature[0],offset+1)){
      const at=scanCursor+offset;
      if(at+(patch.mailbox_size||36)>h.length||!signature.every((v,i)=>h[at+i]===v))continue;
      if(view.getUint32(at+16,true)&&view.getUint16(at+20,true)&&!seen.has(at))seen.set(at,{ticks:0,changed:-Infinity});
    }
    scanCursor=end;
  }
  if(previous!==mailbox)clearNative(previous);
  emulator.module.sidebarPaletteAddress=mailbox<0?-1:mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16+0x2a82;
  return mailbox<0?null:{at:mailbox,mode:h[mailbox+22],flags:h[mailbox+23],generation:view.getUint16(mailbox+24,true)};
}
function tick(now){
  testTools.update(now);
  const ps=emulator?.isWorker?emulator.snapshot.practice:emulator?.practice?.status;
  practiceUI.update({practice:ps});
  const muted=readSoloState()?.mode===2||ps?.mode==='target'&&(!ps.ready||ps.waiting||ps.outcome);
  if(muted||emulator?.state!=='running')soloMusic?.suspend();else if(!document.hidden)soloMusic?.resume();
  if(ps?.outcome&&!playback){
    if(!practiceCompleted){practiceCompleted=true;release();if(!recorder)emulator.pauseReplay(true);}
    practiceUI.complete({outcome:ps.outcome,recording:!!recorder,ready:!!recordBlob,failed:recorder?.state.failed});
  }
  if(emulator?.state==='running'){
    if(!emulator.isWorker)soloMusic?.poll(emulator.module.HEAPU8,now);
    const state=scan(now),game=state?.mode===1;
    const enabled=!playback&&focused&&!document.hidden&&!editor.isEditing()&&($('practice-panel').hidden||!$('practice-panel').classList.contains('practice-full'))&&!ps?.outcome;
    player.setContext({key:`${mailbox}:${state?.generation||0}:${game?'game':'menu'}`,play:enabled&&game&&!state.flags});
    let base=0;
    if(enabled){base=keyboardBits(keys,'solo');try{base|=padBits(Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected),'solo');}catch{}}
    let bits=enabled?player.sample(base):0;
    if((bits&3)===3)bits&=~3;if((bits&12)===12)bits&=~12;
    // The DOS title/options menus poll on their own cadence. Keep a touch
    // button edge down long enough to be sensed, without enabling gameplay fire.
    if(!game&&enabled){
      const touchButtons=bits&~base;
      if(touchButtons){menuBits=touchButtons;menuUntil=now+100;}
      if(now<menuUntil)bits|=menuBits;
      else menuBits=0;
    }else{menuBits=0;menuUntil=0;}
    send(bits);
    const touch=unpackTouch(player.pack(bits));
    const assistInput={address:state?.at??mailbox,generation:state?.generation,points:(focus()?1:0)|(player.alwaysPoint()||ps?.options.alwaysPoint?8:0),
      touch:enabled&&game&&!state.flags?touch:null};
    if(!playback){
      const encoded=JSON.stringify(assistInput),moving=!!assistInput.touch?.active&&(assistInput.touch.x||assistInput.touch.y);
      if(emulator.isWorker)emulator.setInput(assistInput);
      else if(!recorder||moving||encoded!==lastAssist)emulator.assist(assistInput);
      lastAssist=encoded;
    }
    player.consume();
  }
}
startFrameLoop(tick);
for(const type of ['keydown','keyup'])window.addEventListener(type,e=>{
  if(syntheticInputEvents.has(e))return;
  e.stopImmediatePropagation();
  if(type==='keyup'){if(keys.delete(e.code))e.preventDefault();return;}
  if(!emulator||editor.isEditing()||isFormTarget(e.target)||e.metaKey)return;
  if(isBound(e.code,'solo')){e.preventDefault();keys.add(e.code);}
},true);
window.addEventListener('keypress',e=>{if(!syntheticInputEvents.has(e)&&!isFormTarget(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
window.addEventListener('blur',()=>{focused=false;release();});window.addEventListener('focus',()=>{focused=true;});
let hiddenPaused=false;
document.addEventListener('visibilitychange',()=>{if(document.hidden){release();soloMusic?.suspend();hiddenPaused=emulator?.state==='running';emulator?.pause();}
  else if(hiddenPaused){hiddenPaused=false;emulator?.run();soloMusic?.resume();}});
document.addEventListener('focusin',e=>{if(isFormTarget(e.target))release();});
canvas.onpointerdown=()=>canvas.focus();
$('restart').onclick=()=>location.reload();
$('start').onclick=async()=>{
  startGame();
};
async function startGame(replay=null,practiceConfig=null){
  if(replay&&(!['worker','main'].includes(replay.header.runtime)||replay.header.boundaryMode!=='sleep')){setReplayStatus('Replay 运行器版本不匹配');return;}
  if(started||emulator)return;started=true;playback=!!replay;$('start').disabled=true;audioMode.disabled=true;runtimeMode.disabled=true;$('language').disabled=true;player.enter();
  if(playback){
    runtimeMode.value=replay.header.runtime;$('language').value=replay.header.language;audioMode.value=replay.header.audioMode||'original';clearRecording();
  }
  lastAssist='';const version=gameVersion($('language').value);
  const status=text=>{$('status').textContent=text;player.note(text);player.diagnostics(text);};
  try{
    if(playback){const identity=await fingerprint(replaySources);if(identity!==replay.header.identity)throw Error('Replay 与当前游戏或模拟器版本不一致');}
    if(audioMode.value==='independent')soloMusic=new SoloMusic(status);
    const practice=normalizePractice(playback?replay.header.practice:practiceConfig||practiceUI.configuration());
    committedPractice=practice;practiceCompleted=false;practiceUI.setRunning(!playback,practice);
    const practiceResources=await loadPracticeResources($('language').value);
    status(`正在加载${version.label}单机磁盘…`);
    const manifest=await fetch(version.soloPatch,{cache:'no-cache'}).then(response=>{if(!response.ok)throw Error(`配置 HTTP ${response.status}`);return response.json();});
    patch=practiceResources.spec.patch;
    let data,baseDisk;
    if(playback&&replay.disk)data=replay.disk.slice();
    else{
      const response=await fetch(version.soloDisk,{cache:'no-cache'});if(!response.ok)throw Error(`磁盘 HTTP ${response.status}`);
      data=new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      if(data.length!==manifest.disk.size||await sha256(data)!==manifest.disk.sha256)throw Error('单机磁盘校验失败');
      baseDisk=data.slice();
      if(playback)data=await restoreExternalReplayDisk(replay,data);
      else await installPractice(data,practiceResources,practice);
      if(soloMusic&&!playback)await soloMusic.install(data,'GENSO');
    }
    if(soloMusic&&playback)await soloMusic.attachReplay();
    let externalReplay=null;
    if(playback)externalReplay={mode:'playback',boundaryMode:'sleep',clocks:replay.clocks,events:replay.events,endBoundary:replay.header.endBoundary,endReason:replay.header.result.endReason,endPhase:replay.header.result.endPhase,timeline:replay.header.result.timeline,
      onEnd:value=>{
        const matches=value.memoryHash===replay.header.result.memoryHash&&value.memorySha256===replay.header.result.memorySha256;
        status(matches?'Replay 播放完成，终态内存校验一致。':'Replay 已停止：终态内存校验不一致。');
        emulator?.pauseReplay(true);$('replay-pause').disabled=true;replayUI.showEnd(matches);
      },onError:error=>{setReplayStatus('Replay 播放失败：'+error.message);emulator?.pauseReplay(true);}};
    else if($('record-enabled').checked){
      try{
        const identity=await fingerprint(replaySources);
        recorder=createBrowserSoloRecorder({game:'04',language:$('language').value,runtime:runtimeMode.value,identity,patch:patch,boundaryMode:'sleep',disk:data.slice(),baseDisk,practice,audioMode:audioMode.value,
          onStatus:setReplayStatus,onFailure:()=>replayUI.closeSave(),onFile:(blob,value)=>{recordBlob=blob;$('record-save').disabled=false;$('record-discard').disabled=false;if(practice.mode!=='target')replayUI.offerSave(blob,value);},
          onResult:()=>{$('record-finish').disabled=true;if(practice.mode!=='target')replayUI.prepareSave();}});
        externalReplay=recorder.config;$('record-finish').disabled=$('record-discard').disabled=false;setReplayStatus('等待本次首局；结束或通关时询问保存，首次续关前停止记录。');
      }catch(error){clearRecording();setReplayStatus('Replay 未能启动：'+error.message+'；游戏继续。');}
    }else setReplayStatus('本次启动不录制。');
    const config={canvas,externalReplay,practice,practicePatch:patch,wasmBinary:practiceResources.wasmBinary,applyReplayInput:applySoloAssist,ExMemory:7,Latencys:100,SampleHz:44100,SNDboard:4,
      nativeSoloAudio:!externalReplay&&audioMode.value!=='original',no_mouse:true,use_menu:false,fontfile:'font.bmp',
      onExit:()=>{if(!playback){recorder?.finish();}status('游戏已退出，可重新启动。');}};
    emulator=runtimeMode.value==='worker'?await WorkerNP21.create(config,{game:'04',patch,music:soloMusic?.reader.patch,onError:e=>{soloMusic?.suspend();player.exit();status('模拟线程停止：'+e.message);}}):await NP21.create(config);
    recorder?.attach(emulator);
    if(emulator.isWorker)emulator.onMusic=(ax,hash)=>soloMusic?.player.command(ax,hash);
    if(!emulator.isWorker)emulator.module.observeReplayBoundary=()=>soloMusic?.poll(emulator.module.HEAPU8,performance.now(),true);
    await emulator.addDiskImage('th04-solo.hdi',data);await emulator.setHdd(0,'th04-solo.hdi');emulator.run();soloMusic?.start();player.setActive(true);canvas.focus();
    $('replay-fast').disabled=!playback;$('replay-pause').dataset.paused='false';$('replay-pause').textContent='暂停播放';$('replay-pause').disabled=!playback;$('replay-stop').disabled=!playback;$('replay-play').disabled=true;
    status(playback?'正在重播浏览器 Replay。':`${version.label}单机已启动，请等待开头，在游戏内选择模式与角色。`);$('restart').disabled=false;
  }catch(e){emulator?.dispose?.();emulator=null;recorder?.dispose();recorder=null;soloMusic?.dispose();soloMusic=null;player.setActive(false);player.exit();playback=false;started=false;practiceUI.setRunning(false);$('start').disabled=false;audioMode.disabled=runtimeMode.disabled=$('language').disabled=false;status(`启动失败：${e.message}`);$('restart').disabled=false;console.error(e);}
}

$('record-finish').onclick=()=>recorder?.finish();
$('record-save').onclick=()=>{if(!recordBlob)return;const url=URL.createObjectURL(recordBlob),a=document.createElement('a');a.href=url;a.download='th04-solo.th04r';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);replayUI.closeSave();setReplayStatus('Replay 已请求保存；重新启动游戏可录制新局。');};
$('record-discard').onclick=()=>{clearRecording();setReplayStatus('Replay 已丢弃，游戏继续；重新启动游戏可录制新局。');};
$('replay-file').onchange=async event=>{
  try{const file=event.target.files[0];if(!file)return;loadedReplay=await decodeExternalReplay(file,'04');
    $('replay-play').disabled=!!(emulator||started);setReplayStatus(`已载入 ${file.name}，可开始独立重播。`);
  }catch(error){loadedReplay=null;$('replay-play').disabled=true;setReplayStatus('Replay 导入失败：'+error.message);}
};
$('replay-play').onclick=()=>{if(loadedReplay&&!emulator&&!started)startGame(loadedReplay);};
$('replay-pause').onclick=()=>{if(!emulator||!playback)return;const paused=$('replay-pause').dataset.paused==='true';
  emulator.pauseReplay(!paused);$('replay-pause').dataset.paused=String(!paused);$('replay-pause').textContent=paused?'暂停播放':'继续播放';canvas.focus();};
function stopPlayback(){
  if(!playback)return;replayUI.reset();release();emulator?.dispose?.();emulator=null;playback=false;
  practiceUI.setRunning(false);committedPractice=null;practiceCompleted=false;
  soloMusic?.dispose();soloMusic=null;
  const next=canvas.cloneNode(false);canvas.replaceWith(next);canvas=next;canvas.onpointerdown=()=>canvas.focus();
  started=false;mailbox=-1;scanCursor=0;seen.clear();audioMode.disabled=runtimeMode.disabled=$('language').disabled=false;
  $('start').disabled=false;$('replay-play').disabled=!loadedReplay;
  $('replay-stop').disabled=$('replay-pause').disabled=$('replay-fast').disabled=true;$('replay-pause').textContent='暂停播放';
  $('status').textContent='Replay 已结束，可以再次播放、导入其他录像或开始游戏。';
}
$('replay-stop').onclick=stopPlayback;
async function restartPractice(config){
  release();clearRecording();replayUI.reset();practiceUI.setRunning(false);soloMusic?.dispose();soloMusic=null;emulator?.dispose?.();emulator=null;started=false;playback=false;
  mailbox=-1;scanCursor=0;seen.clear();oldBits=0;
  const next=canvas.cloneNode(false);canvas.replaceWith(next);canvas=next;canvas.onpointerdown=()=>canvas.focus();
  await startGame(null,config);
}
window.addEventListener('pagehide',()=>{recorder?.dispose();emulator?.dispose?.();});

// Read-only diagnostics used by the standalone browser smoke test.
export function readFrameStats(){return {limit:60,callbacks:emulator?.module.localFrameCount||0};}
export function readSoloState(){
  if(emulator?.isWorker)return emulator.snapshot.state;
  if(!emulator||mailbox<0)return null;
  const h=emulator.module.HEAPU8,v=new DataView(h.buffer);
  const data=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
  return {at:mailbox,mode:h[mailbox+22],flags:h[mailbox+23],ticks:v.getUint32(mailbox+16,true),
    generation:v.getUint16(mailbox+24,true),pointOptions:h[mailbox+26],
    x:v.getInt16(data+0x464e,true)/16,y:v.getInt16(data+0x4650,true)/16,
    stage:h[data+0x5394],focus:h[data+0x3976],touchFlags:v.getUint16(mailbox+28,true),
    ...readSoloDiagnostics(h,mailbox,patch)};
}
