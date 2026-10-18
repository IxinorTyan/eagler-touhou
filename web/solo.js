import {DOSBoxPC98} from './dosbox-adapter.js';
import {sha256} from './solo-fat12.js';
import {SoloMusic} from './solo-music.js';
import {mountPlayer} from './player-ui.js';
import {mountControlSettings,keyboardBits,padBits,isBound,isFormTarget,controlsSummary} from './control-settings.js';
import {mountFocusSettings} from './netplay/focus-display.js';
import {unpackTouch} from './touch-input.js';

const $=id=>document.getElementById(id),keys=new Set();
const nativeKeys=[['ArrowUp',1],['ArrowDown',2],['ArrowLeft',4],['ArrowRight',8],['KeyX',16],['KeyZ',32],['Escape',128],['Enter',256]];
let emulator=null,music=null,patch=null,mailbox=-1,cursor=0,lastKeys=0,focused=document.hasFocus(),editing=false,launching=false,hiddenPause=false;
const status=text=>{$('status').textContent=text;};
const host=document.createElement('div');$('game').append(host);
host.hidden=true;
const player=mountPlayer(host,{solo:true,onGesture:()=>{emulator?.audio.context.resume().catch(()=>{});music?.resume();},onChange:()=>syncInput()});
const screen=document.createElement('div');screen.className='screen solo-screen';
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;canvas.tabIndex=0;canvas.setAttribute('aria-label','东方封魔录单人游戏画面');screen.append(canvas);player.stage.prepend(screen);
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
  return ds>patch.dataSegment&&base>=0&&base+0x100000<=heap.length&&heap[at+22]<=2;
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
function syncInput(motion=false){
  if(!emulator)return;
  const enabled=focused&&!editing&&!document.hidden&&emulator.state==='running';
  let bits=enabled?keyboardBits(keys,'solo')|padBits(navigator.getGamepads?.()[Number($('gamepad').value)],'solo'):0;
  if(enabled)bits=player.sample(bits);
  if((bits&3)===3)bits&=~3;if((bits&12)===12)bits&=~12;
  for(const [code,bit]of nativeKeys)if((bits&bit)!==(lastKeys&bit))emulator.key(code,!!(bits&bit));
  lastKeys=bits;
  if(mailbox>=0){
    const h=emulator.module.HEAPU8,v=new DataView(h.buffer),base=mailbox-patch.entries.mailbox;
    // The original game retains its own key sampler. Only focus and direct
    // touch motion use the separate assist mailbox.
    v.setUint16(base+patch.entries.currentInput,enabled&&(bits&64)?0x100:0,true);
    // The native assist always uses half of this aircraft's normal speed.
    h[mailbox+100]=50;h[mailbox+102]=$('focus-enabled').checked?1:0;
    h[mailbox+103]=pointMask()|(player.alwaysPoint()?8:0);
    const touch=base+patch.entries.touch,state=readSoloState(),play=enabled&&state?.mode===1&&!state.hit;
    if(motion){
      const m=unpackTouch(player.pack(bits));
      if(play&&m.active){const clamp=n=>Math.max(-8192,Math.min(8191,n));v.setUint16(touch,m.unlimited?3:1,true);v.setInt16(touch+2,clamp(v.getInt16(touch+2,true)+m.x),true);v.setInt16(touch+4,clamp(v.getInt16(touch+4,true)+m.y),true);}
      else {v.setUint16(touch,0,true);v.setInt32(touch+2,0,true);}
      player.consume();
    }else if(!play||!player.moving()){v.setUint16(touch,0,true);v.setInt32(touch+2,0,true);}
  }
}
function release(){keys.clear();player.reset();syncInput();}
window.addEventListener('keydown',event=>{
  if(!emulator||editing||isFormTarget(event.target)||event.metaKey||event.ctrlKey||event.altKey)return;
  if(isBound(event.code,'solo')||nativeKeys.some(([code])=>code===event.code)){
    event.preventDefault();event.stopImmediatePropagation();
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
    }catch(error){status('运行错误：'+error.message);}
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
$('start').onclick=async()=>{
  if(launching||emulator)return;launching=true;$('start').disabled=true;
  try{
    status('正在加载单人游戏…');
    if($('audio-mode').value==='independent')music=new SoloMusic(message=>status(message));
    const response=await fetch('solo-patch.json');if(!response.ok)throw Error('单人配置加载失败');
    patch=(await response.json()).disks[$('language').value];
    const disk=await fetch(patch.file);if(!disk.ok)throw Error('单人磁盘加载失败');
    const data=new Uint8Array(await new Response(disk.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    if(data.length!==patch.size||await sha256(data)!==patch.sha256)throw Error('单人磁盘校验失败');
    if(music){await music.install(data,'HUMAROKU');music.player.setVolume(Number(volume.querySelector('input').value)/100);}
    emulator=await DOSBoxPC98.create({canvas,onError:error=>{music?.suspend();player.setActive(false);status('游戏停止：'+error.message);},onExit:()=>{music?.suspend();player.setActive(false);status('游戏已退出，可重新启动。');}});
    emulator.addDiskImage('th02-solo.hdi',data);await emulator.setHdd(0,'th02-solo.hdi');emulator.run();
    $('language').disabled=$('audio-mode').disabled=true;$('pause').disabled=false;focused=true;host.hidden=false;player.setActive(true);canvas.focus();
    status('单人游戏已启动。可用 Z／Enter 跳过开头，在原版菜单选择难度和机体。');
  }catch(error){emulator?.dispose();emulator=null;music?.dispose();music=null;player.setActive(false);status('启动失败：'+error.message);$('start').disabled=false;}
  finally{launching=false;$('restart').disabled=false;}
};
$('pause').onclick=()=>{
  if(emulator?.state==='running'){release();emulator.pause();music?.suspend();$('pause').textContent='继续运行';}
  else if(emulator?.state==='paused'){emulator.run();music?.resume();$('pause').textContent='暂停运行';canvas.focus();}
};
$('restart').onclick=()=>location.reload();
window.addEventListener('pagehide',()=>{release();music?.dispose();emulator?.dispose();});
