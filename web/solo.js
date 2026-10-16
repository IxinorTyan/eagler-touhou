import {createFastCore,prepareFastCore} from './dosbox-runtime.js';
import {loadVerifiedBytes} from './startup-assets.js';
import {mountPlayer} from './player-ui.js';
import {unpackTouch} from './touch-input.js';

const $=id=>document.getElementById(id);
let emulator=null,busy=false,disposed=false,oldButtons=0,lastInfo=0,menuBits=0,menuUntil=0;
const held=new Set(),pulses=new Map();
const keys={ArrowUp:1,ArrowDown:2,ArrowLeft:4,ArrowRight:8,KeyX:16,KeyZ:32,ShiftLeft:64,ShiftRight:64,Escape:128,Enter:256};
const nativeCodes=[[1,265],[2,264],[4,263],[8,262],[16,88],[32,90],[64,340],[128,256],[256,257]];
const player=mountPlayer($('player'),{solo:true,onGesture:enableSound});
$('screen').classList.add('screen');player.stage.append($('screen'));
player.setLabel('原版单人');player.note('启动后使用原版标题菜单；触屏可开启触屏操作。');
const status=text=>{$('status').textContent=text;};
const form=target=>target?.closest?.('select,input,textarea,button,a');
function enableSound(){if(emulator?.state==='running')return emulator.audio?.resume();}
function applyButtons(value){
  if(!emulator)return;
  for(const [bit,code]of nativeCodes)if((value^oldButtons)&bit)emulator.key(code,!!(value&bit));
  oldButtons=value;
}
function points(){return ($('focus-point').checked?1:0)|(player.alwaysPoint()?8:0);}
function release(){
  held.clear();pulses.clear();menuBits=menuUntil=0;player.reset();applyButtons(0);
  emulator?.inputs({generation:emulator.readState()?.generation,points:points(),touch:null});
}
function pulse(bit){pulses.set(bit,performance.now()+110);}
function context(){
  const state=emulator?.readState(),game=state?.mode===1;
  player.setActive(emulator?.state==='running');
  // Native status distinguishes play, injury/entry, pause, demo and transitions.
  // As in TH04, keep the fire preference through stage/context changes, while
  // suppressing its output in menus and temporarily blocked player states.
  player.setContext({key:`${state?.at??-1}:${state?.generation||0}:${game?'game':'menu'}`,
    play:emulator?.state==='running'&&!document.hidden&&game&&!state.flags});
  return state;
}
function pause(){
  if(emulator?.state!=='running'||![1,2].includes(emulator.readState()?.mode))return;
  release();emulator.gamePause();$('canvas').focus();
}
for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
  if(!emulator||!(event.code in keys)||event.ctrlKey||event.metaKey||event.altKey)return;
  if(form(event.target)&&!held.has(event.code))return;
  if(emulator.state!=='running')return;
  event.preventDefault();
  if(type==='keydown'){
    held.add(event.code);enableSound();
  }else held.delete(event.code);
});
for(const button of document.querySelectorAll('[data-key]')){
  button.onclick=()=>{if(emulator?.state==='running'){enableSound();pulse(keys[button.dataset.key]);}};
}
window.addEventListener('blur',release);
document.addEventListener('focusin',event=>{if(form(event.target))release();});
document.addEventListener('visibilitychange',()=>{
    if(document.hidden){release();if(emulator?.state==='running'&&emulator.readState()?.mode===1)emulator.gamePause({onlyPause:true});}
});
window.addEventListener('pagehide',()=>{disposed=true;release();emulator?.stop();});
function tick(now){
  if(disposed)return;
  const state=context();
  if(emulator){$('pause').disabled=![1,2].includes(state?.mode);$('pause').textContent=state?.mode===2?'继续游戏':'暂停游戏';}
  if(emulator?.state==='running'){
    const game=state?.mode===1;
    let base=0;for(const key of held)base|=keys[key];
    let value=player.sample(base);
    // DOS menus poll independently. TH04 holds touch edges for 100 ms, while
    // gameplay movement goes through the accumulated native touch mailbox.
    if(!game){
      const touchButtons=value&~base;
      if(touchButtons){menuBits=touchButtons;menuUntil=now+110;}
      if(now<menuUntil)value|=menuBits;else menuBits=0;
    }else{
      menuBits=menuUntil=0;
      for(const bit of [16,128,256])if((value&~base)&bit)pulses.set(bit,now+110);
    }
    for(const [bit,until]of pulses)if(now<until)value|=bit;else pulses.delete(bit);
    if((value&3)===3)value&=~3;if((value&12)===12)value&=~12;
    applyButtons(value);
    const touch=unpackTouch(player.pack(value));
    emulator.inputs({generation:state?.generation,points:points(),touch:game&&!state.flags?touch:null});
    player.consume();
  }
  if(emulator&&now-lastInfo>500){
    lastInfo=now;
    const text=JSON.stringify({mode:'original-solo',status:emulator.state,music:emulator.bgm?.status||'PC-98',musicError:emulator.musicError,state:emulator.readState()},null,2);
    $('diagnostics').textContent=text;player.diagnostics(text);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

async function readDisk(language){
  const manifestResponse=await fetch('solo-disks.json',{cache:'no-store'});
  if(!manifestResponse.ok)throw Error('原版磁盘清单读取失败');
  const item=(await manifestResponse.json()).languages[language];
  if(!item.inputPatch)throw Error('原版单人触摸资源需要更新，请重新生成单人磁盘');
  const disk=await loadVerifiedBytes(new URL(item.url,import.meta.url),item.sha256,{gzip:true,size:item.size});
  return {disk,patch:item.inputPatch};
}
function failure(error){
  release();if(emulator&&!['failed','stopped'].includes(emulator.state))emulator.stop();emulator=null;player.setActive(false);
  status('启动或运行失败：'+error.message);player.note('请查看错误原因，调整后重新开始。');
  $('start').disabled=false;$('pause').disabled=true;$('capture').disabled=true;$('sound').disabled=true;
}
function endSession(){
  emulator?.stop();emulator=null;held.clear();pulses.clear();oldButtons=0;player.setActive(false);player.exit();
  const canvas=$('canvas');canvas.replaceWith(canvas.cloneNode(false));
  for(const id of ['pause','capture','sound'])$(id).disabled=true;
  $('start').disabled=false;$('restart').disabled=false;status('已退出模拟器，本局结束。可重新启动原版。');
}
async function start(){
  if(busy||disposed)return;busy=true;
  release();emulator?.stop();emulator=null;
  for(const id of ['start','restart','pause','capture','sound'])$(id).disabled=true;
  player.setActive(false);status('正在载入原版磁盘…');
  const canvas=document.createElement('canvas');canvas.id='canvas';canvas.width=640;canvas.height=400;canvas.tabIndex=0;canvas.setAttribute('aria-label','怪绮谈原版单人游戏画面');
  $('canvas').replaceWith(canvas);canvas.onpointerdown=()=>canvas.focus();
  const language=$('language').value,independentMusic=$('audio-mode').value==='independent';
  $('bgm-control').hidden=!independentMusic;
  try{
    const coreTask=prepareFastCore();coreTask.catch(()=>{});
    const {disk,patch}=await readDisk(language);if(disposed)return;
    status('正在启动 PC-98 原版游戏…');
    const core=await createFastCore({canvas,disk,patch,solo:true,independentMusic,coreTask});
    if(disposed){core.stop();return;}emulator=core;emulator.onError=failure;emulator.onExit=endSession;
    emulator.bgm?.setVolume(Number($('bgm-volume').value)/100);
    $('pause').disabled=false;$('capture').disabled=false;$('sound').disabled=false;
    $('pause').textContent='暂停游戏';player.setLabel(`${language==='cn'?'汉化版':'日文版'} · 原版单人`);
    status('原版单人运行中 · 请在标题菜单选择角色与难度。');
    player.note('方向键选择，Z / Enter 确认，X 返回。Esc 打开原版暂停菜单。');
    canvas.focus();if(document.hidden)pause();
  }catch(error){if(!disposed)failure(error);}
  finally{busy=false;if(!disposed)$('restart').disabled=false;}
}
$('start').onclick=start;$('restart').onclick=start;$('pause').onclick=pause;
$('fullscreen').onclick=()=>player.enter();$('sound').onclick=enableSound;
$('bgm-volume').oninput=()=>emulator?.bgm?.setVolume(Number($('bgm-volume').value)/100);
$('capture').onclick=async()=>{
  if(!emulator)return;
  try{
    const blob=await emulator.capture(),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='th05-solo.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){status('保存画面失败：'+error.message);}
};
