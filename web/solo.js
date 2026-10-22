import {DOSBoxPC98} from './dosbox-adapter.js';
import {sha256} from './solo-fat12.js';
import {SoloMusic} from './solo-music.js';
import {mountPlayer} from './player-ui.js';
import {mountControlSettings,keyboardBits,padBits,isBound,isFormTarget,controlsSummary} from './control-settings.js';
import {mountFocusSettings} from './netplay/focus-display.js';
import {unpackTouch} from './touch-input.js';
import {createBrowserSoloRecorder} from './replay/external-recorder.js';
import {decodeExternalReplay,restoreExternalReplayDisk} from './replay/external-codec.js';
import {fingerprint} from './replay/tape.js';
import {mountSoloReplayToolbar} from './replay/external-ui.js';
import {readSoloBoss,mountSoloBossHud,compatibleSoloReplay} from './solo-boss-hud.js';

const $=id=>document.getElementById(id),keys=new Set();
const nativeKeys=[['ArrowUp',1],['ArrowDown',2],['ArrowLeft',4],['ArrowRight',8],['KeyX',16],['KeyZ',32],['Escape',128],['Enter',256]];
const residentSignature=new TextEncoder().encode('MIKOConfig\0');
let emulator=null,music=null,patch=null,mailbox=-1,cursor=0,lastKeys=0,focused=document.hasFocus(),editing=false,launching=false,hiddenPause=false;
let recorder=null,recordBlob=null,loadedReplay=null,playback=false,lastAssist='';
const status=text=>{$('status').textContent=text;};
const host=document.createElement('div');$('game').append(host);
host.hidden=true;
const player=mountPlayer(host,{solo:true,onGesture:()=>{emulator?.audio.context.resume().catch(()=>{});music?.resume();},onChange:()=>syncInput()});
let saveWasPaused=false;
const replayUI=mountSoloReplayToolbar(host,{isPlayback:()=>playback,isSynthetic:()=>false,
  onHold:()=>{saveWasPaused=emulator?.state==='paused';release();emulator?.pauseReplay(true);},
  onRelease:()=>{if(!saveWasPaused&&emulator&&emulator.state!=='exited')emulator.pauseReplay(false);canvas.focus();},
  onAgain:()=>{stopPlayback();startGame(loadedReplay);},onStop:()=>stopPlayback(),onFast:value=>emulator?.fastForwardReplay(value),
});
const screen=document.createElement('div');screen.className='screen solo-screen';
let canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;canvas.tabIndex=0;canvas.setAttribute('aria-label','东方封魔录单人游戏画面');screen.append(canvas);player.stage.prepend(screen);
const bossHud=mountSoloBossHud(screen);
player.setLabel('单人游戏');
mountControlSettings($('control-settings'),{solo:true,onChange:()=>{$('controls-summary').textContent=controlsSummary('solo');release();},onEditing:value=>{editing=value;release();}});
const pointMask=mountFocusSettings($('control-settings'),{profile:'solo',alwaysPointControl:player.alwaysPointControl});
$('controls-summary').textContent=controlsSummary('solo');
const volume=document.createElement('label');volume.className='player-volume';volume.innerHTML='BGM <input type="range" min="0" max="100" value="70" aria-label="音乐音量">';$('control-settings').append(volume);
volume.querySelector('input').oninput=event=>music?.player.setVolume(Number(event.target.value)/100);
try{
  for(const id of ['language','audio-mode','gamepad']){const saved=localStorage.getItem('th02.solo.'+id);if(saved&&[...$(id).options].some(o=>o.value===saved))$(id).value=saved;}
  $('focus-enabled').checked=localStorage.getItem('th02.solo.focus-enabled')!=='false';
  localStorage.removeItem('th02.solo.focus-percent');
}catch{}
for(const id of ['language','audio-mode','gamepad'])$(id).addEventListener('change',()=>{try{localStorage.setItem('th02.solo.'+id,$(id).value);}catch{};release();});
$('focus-enabled').addEventListener('change',()=>{try{localStorage.setItem('th02.solo.focus-enabled',String($('focus-enabled').checked));}catch{}release();});
const showVolume=()=>{volume.hidden=$('audio-mode').value!=='independent';};$('audio-mode').addEventListener('change',showVolume);showVolume();

function valid(heap,at){
  if(!patch||at<0||at+104>heap.length)return false;
  const sig=patch.signature;
  for(let i=0;i<sig.length;i++)if(heap[at+i]!==sig.charCodeAt(i))return false;
  const ds=heap[at+20]|heap[at+21]<<8;
  const data=at-patch.entries.mailbox+(patch.dataSegment-patch.codeSegment)*16;
  const base=data-ds*16;
  if(ds<=patch.dataSegment||base<0||base+0x100000>heap.length||data<base||data+0x2800>base+0xa0000||heap[at+22]>2)return false;
  const view=new DataView(heap.buffer,heap.byteOffset,heap.byteLength);
  const resident=base+view.getUint16(data+0x27fc,true)+view.getUint16(data+0x27fe,true)*16;
  return resident>=base&&resident+48<=base+0xa0000&&residentSignature.every((b,i)=>heap[resident+i]===b)&&heap[resident+11]<=5;
}
function scan(){
  const h=emulator.module.HEAPU8;
  if(valid(h,mailbox))return;
  mailbox=-1;const end=Math.min(h.length,cursor+2*1024*1024);
  for(let at=h.indexOf(84,cursor);at>=0&&at<end;at=h.indexOf(84,at+1))if(valid(h,at)){mailbox=at;break;}
  cursor=end===h.length?0:end;
}
export function readSoloState(){
  if(!emulator||!valid(emulator.module.HEAPU8,mailbox))return null;
  const h=emulator.module.HEAPU8,v=new DataView(h.buffer),data=mailbox-patch.entries.mailbox+(patch.dataSegment-patch.codeSegment)*16;
  return {mode:h[mailbox+22],generation:v.getUint16(mailbox+24,true),ticks:v.getUint32(mailbox+16,true),x:v.getInt16(data+0x2b86,true),y:v.getInt16(data+0x2b88,true),lives:h[data+0xb2c],bombs:h[data+0xb2d],hit:h[data+0x2b94]|h[data+0xaa7],power:h[data+0xaa6]};
}
export function readSoloAudio(){return {status:music?.player.status||'原版声音',track:music?.player.active?.id||null};}
function applyAssist(input){
  if(!emulator)return;const at=input.address;
  const h=emulator.module.HEAPU8;if(!valid(h,at))return;
  const v=new DataView(h.buffer),base=at-patch.entries.mailbox;
  if(input.generation!==v.getUint16(at+24,true))return;
  v.setUint16(base+patch.entries.currentInput,input.currentInput,true);
  h[at+100]=50;h[at+102]=input.focusEnabled?1:0;h[at+103]=input.points;
  const touch=base+patch.entries.touch;
  if(input.touchAction==='add'){
    const clamp=n=>Math.max(-8192,Math.min(8191,n));
    v.setUint16(touch,input.unlimited?3:1,true);
    v.setInt16(touch+2,clamp(v.getInt16(touch+2,true)+input.x),true);
    v.setInt16(touch+4,clamp(v.getInt16(touch+4,true)+input.y),true);
  }else if(input.touchAction==='clear'){v.setUint16(touch,0,true);v.setInt32(touch+2,0,true);}
}
function syncInput(motion=false){
  if(!emulator||playback)return;
  const enabled=focused&&!editing&&!document.hidden&&emulator.state==='running';
  let bits=enabled?keyboardBits(keys,'solo')|padBits(navigator.getGamepads?.()[Number($('gamepad').value)],'solo'):0;
  if(enabled)bits=player.sample(bits);
  if((bits&3)===3)bits&=~3;if((bits&12)===12)bits&=~12;
  for(const [code,bit]of nativeKeys)if((bits&bit)!==(lastKeys&bit))emulator.key(code,!!(bits&bit));
  lastKeys=bits;
  if(mailbox>=0){
    const state=readSoloState(),inGame=enabled&&state?.mode===1&&!state.hit,m=motion?unpackTouch(player.pack(bits)):null;
    const command={address:mailbox,generation:state?.generation,currentInput:enabled&&(bits&64)?0x100:0,focusEnabled:$('focus-enabled').checked,points:pointMask()|(player.alwaysPoint()?8:0),
      touchAction:motion?(inGame&&m.active?'add':'clear'):(!inGame||!player.moving()?'clear':'keep'),
      unlimited:!!m?.unlimited,x:m?.x||0,y:m?.y||0};
    const encoded=JSON.stringify(command),moving=command.touchAction==='add'&&(command.x||command.y);
    if(!recorder||moving||encoded!==lastAssist)emulator.assist(command);
    lastAssist=encoded;
    if(motion)player.consume();
  }
}
function release(){keys.clear();player.reset();syncInput();}
window.addEventListener('keydown',event=>{
  if(!emulator||editing||isFormTarget(event.target)||event.metaKey||event.ctrlKey||event.altKey)return;
  if(isBound(event.code,'solo')||nativeKeys.some(([code])=>code===event.code)){
    event.preventDefault();event.stopImmediatePropagation();
    if(playback)return;
    if(isBound(event.code,'solo'))keys.add(event.code);syncInput();
  }
},true);
window.addEventListener('keyup',event=>{if(keys.delete(event.code)){event.preventDefault();event.stopImmediatePropagation();syncInput();}},true);
window.addEventListener('blur',()=>{focused=false;release();});window.addEventListener('focus',()=>{focused=true;});
document.addEventListener('focusin',event=>{if(isFormTarget(event.target))release();});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){release();hiddenPause=emulator?.state==='running';if(hiddenPause)emulator.pause();music?.suspend();}
  else if(hiddenPause){hiddenPause=false;emulator?.run();music?.resume();}
});
function tick(now){
  if(emulator?.module.HEAPU8){
    try{scan();const s=readSoloState(),play=s?.mode===1;
      player.setActive(emulator.state==='running');player.setContext({key:`${s?.generation??0}:${play?'game':'menu'}`,play:play&&!s.hit});
      syncInput(true);music?.poll(emulator.module.HEAPU8,now);
      const data=mailbox-patch.entries.mailbox+(patch.dataSegment-patch.codeSegment)*16;
      bossHud.update(s?readSoloBoss(emulator.module.HEAPU8,data,s.mode):null,s?.generation,s?.ticks);
    }catch(error){status('运行错误：'+error.message);}
  }else bossHud.hide();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
const replaySources=['../solo.js','../dosbox-adapter.js','../dosbox-disk.js','../frame-presenter.js','../solo-patch.json','../vendor/dosbox-x/wdosbox-x-fast.wasm','../vendor/dosbox-x/emulators.js','../vendor/dosbox-x/dosbox-jspi.mjs',
  '../touch-input.js','../control-settings.js','./external-host.js','./external-loader.js','./external-codec.js','./external-recorder.js','./external-ui.js','./external-lifecycle.js'];
const setReplayStatus=text=>{$('replay-status').textContent=text;};
function clearRecording(){recorder?.dispose();recorder=null;recordBlob=null;$('record-save').disabled=true;$('record-discard').disabled=true;$('record-finish').disabled=true;replayUI.closeSave();}
async function startGame(replay=null){
  if(launching||emulator)return;launching=true;$('start').disabled=true;playback=!!replay;lastAssist='';
  try{
    status('正在加载单人游戏…');
    if(playback){$('language').value=replay.header.language;$('audio-mode').value='original';$('record-enabled').checked=false;clearRecording();}
    const recordEnabled=!playback&&$('record-enabled').checked;
    if(!playback&&$('audio-mode').value==='independent'&&!recordEnabled)music=new SoloMusic(message=>status(message));
    const response=await fetch('solo-patch.json');if(!response.ok)throw Error('单人配置加载失败');
    const language=$('language').value;patch=(await response.json()).disks[language];
    let data,baseDisk;
    if(playback&&replay.disk)data=replay.disk.slice();
    else{
      const disk=await fetch(patch.file);if(!disk.ok)throw Error('单人磁盘加载失败');
      data=new Uint8Array(await new Response(disk.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      if(data.length!==patch.size||await sha256(data)!==patch.sha256)throw Error('单人磁盘校验失败');
      baseDisk=data.slice();
      if(playback)data=await restoreExternalReplayDisk(replay,data);
    }
    if(music){await music.install(data,'HUMAROKU');music.player.setVolume(Number(volume.querySelector('input').value)/100);}
    let externalReplay=null;
    if(playback){
      const identity=await fingerprint(replaySources);
      if(!await compatibleSoloReplay(replay.header.identity,identity)||replay.header.runtime!=='main'||replay.header.boundaryMode!=='sleep')throw Error('Replay 与当前游戏或模拟器版本不一致');
      externalReplay={mode:'playback',boundaryMode:replay.header.boundaryMode,clocks:replay.clocks,events:replay.events,endBoundary:replay.header.endBoundary,endReason:replay.header.result.endReason,endPhase:replay.header.result.endPhase,timeline:replay.header.result.timeline,
        onEnd:value=>{
          const matches=value.memoryHash===replay.header.result.memoryHash&&value.memorySha256===replay.header.result.memorySha256;
          status(matches?'Replay 播放完成，终态内存校验一致。':'Replay 已停止：终态内存校验不一致。');
          emulator?.pauseReplay(true);$('replay-pause').disabled=true;replayUI.showEnd(matches);
        },onError:error=>{status('Replay 播放失败：'+error.message);emulator?.pauseReplay(true);}};
    }else if(recordEnabled){
      try{
        const identity=await fingerprint(replaySources);
        recorder=createBrowserSoloRecorder({game:'02',language,runtime:'main',identity,patch:patch,disk:data.slice(),baseDisk,
          onStatus:setReplayStatus,onFailure:()=>replayUI.closeSave(),onFile:(blob,value)=>{recordBlob=blob;$('record-save').disabled=false;$('record-discard').disabled=false;replayUI.offerSave(blob,value);},
          onResult:()=>{$('record-finish').disabled=true;replayUI.prepareSave();}});
        externalReplay=recorder.config;$('record-finish').disabled=$('record-discard').disabled=false;
        setReplayStatus('等待本次首局；结束或通关时询问保存，首次续关前停止记录。');
        if($('audio-mode').value==='independent')setReplayStatus('Replay 使用原版音源；首局结束或通关时询问保存。');
      }catch(error){clearRecording();setReplayStatus('Replay 未能启动：'+error.message+'；游戏继续。');}
    }else setReplayStatus('本次启动不录制。');
    emulator=await DOSBoxPC98.create({canvas,externalReplay,applyReplayInput:applyAssist,
      onError:error=>{music?.suspend();player.setActive(false);status('游戏停止：'+error.message);},
      onExit:()=>{recorder?.finish();music?.suspend();player.setActive(false);status('游戏已退出，可重新启动。');}});
    recorder?.attach(emulator);
    emulator.addDiskImage('th02-solo.hdi',data);await emulator.setHdd(0,'th02-solo.hdi');emulator.run();
    $('language').disabled=$('audio-mode').disabled=true;$('pause').disabled=false;focused=true;host.hidden=false;player.setActive(true);canvas.focus();
    $('replay-pause').dataset.paused='false';$('replay-pause').textContent='暂停播放';$('pause').disabled=playback;$('replay-fast').disabled=!playback;$('replay-pause').disabled=!playback;$('replay-stop').disabled=!playback;
    status(playback?'正在重播浏览器 Replay。':'单人游戏已启动。可用 Z／Enter 跳过开头，在原版菜单选择难度和机体。');
  }catch(error){emulator?.dispose();emulator=null;clearRecording();music?.dispose();music=null;player.setActive(false);playback=false;status('启动失败：'+error.message);$('start').disabled=false;}
  finally{launching=false;$('restart').disabled=false;}
}
$('start').onclick=()=>startGame();
$('pause').onclick=()=>{
  if(emulator?.state==='running'){release();emulator.pause();music?.suspend();$('pause').textContent='继续运行';}
  else if(emulator?.state==='paused'){emulator.run();music?.resume();$('pause').textContent='暂停运行';canvas.focus();}
};
$('restart').onclick=()=>location.reload();
$('record-finish').onclick=()=>recorder?.finish();
$('record-save').onclick=()=>{if(!recordBlob)return;const url=URL.createObjectURL(recordBlob),link=document.createElement('a');link.href=url;link.download='th02-solo.th02r';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);replayUI.closeSave();setReplayStatus('Replay 已请求保存；重新启动游戏可录制新局。');};
$('record-discard').onclick=()=>{clearRecording();setReplayStatus('Replay 已丢弃，游戏继续；重新启动游戏可录制新局。');};
$('replay-file').onchange=async event=>{
  try{const file=event.target.files[0];if(!file)return;loadedReplay=await decodeExternalReplay(file,'02');$('language').value=loadedReplay.header.language;
    $('replay-play').disabled=false;setReplayStatus(`已载入 ${file.name}，可开始独立重播。`);
  }catch(error){loadedReplay=null;$('replay-play').disabled=true;setReplayStatus('Replay 导入失败：'+error.message);}
};
$('replay-play').onclick=async()=>{
  if(!loadedReplay)return;
  if(emulator){release();emulator.dispose();emulator=null;}
  music?.dispose();music=null;clearRecording();await startGame(loadedReplay);
};
$('replay-pause').onclick=()=>{if(!emulator||!playback)return;const paused=$('replay-pause').dataset.paused==='true';
  emulator.pauseReplay(!paused);$('replay-pause').dataset.paused=String(!paused);$('replay-pause').textContent=paused?'暂停播放':'继续播放';canvas.focus();};
function stopPlayback(){
  if(!playback)return;replayUI.reset();release();emulator?.dispose?.();emulator=null;playback=false;
  bossHud.hide();
  const next=canvas.cloneNode(false);canvas.replaceWith(next);canvas=next;canvas.onpointerdown=()=>canvas.focus();
  $('language').disabled=$('audio-mode').disabled=false;$('pause').disabled=true;
  $('start').disabled=false;$('replay-play').disabled=!loadedReplay;
  $('replay-stop').disabled=$('replay-pause').disabled=$('replay-fast').disabled=true;$('replay-pause').textContent='暂停播放';
  $('status').textContent='Replay 已结束，可以再次播放、导入其他录像或开始游戏。';
}
$('replay-stop').onclick=stopPlayback;
window.addEventListener('pagehide',()=>{release();recorder?.dispose();music?.dispose();emulator?.dispose();});
