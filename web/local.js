import {installConfig} from './launch-config.js';
import {createFastCore,prepareFastCore} from './dosbox-runtime.js';
import {loadVerifiedBytes} from './startup-assets.js';
import {mountPlayer} from './player-ui.js';
import {packTouch,unpackTouch,ALWAYS_POINT} from './touch-input.js';
const player=mountPlayer(document.getElementById('player'),{onGesture:()=>emulator?.state==='running'?emulator.audio?.resume():undefined});
const screen=document.getElementById('screen');screen.classList.add('screen');player.stage.append(screen);
let touchSlot=0;
let touchTick=-1,touchButtons=0,touchValue=0;
let menuPulse=0,menuPulseUntil=0;


const $ = id => document.getElementById(id);
const qaEnabled=new URLSearchParams(location.search).has('qa');
const p1Keys = {ArrowUp:1,ArrowDown:2,ArrowLeft:4,ArrowRight:8,KeyZ:32,ShiftLeft:64,ShiftRight:64,Escape:128,Enter:256,KeyX:16};
const p3Keys = {KeyT:1,KeyG:2,KeyF:4,KeyH:8,KeyV:32,KeyB:16,KeyN:64};
const mappings=[p1Keys,null,p3Keys];
const p2Keys = {KeyW:1,KeyS:2,KeyA:4,KeyD:8,KeyJ:32,KeyL:16,KeyK:64};
mappings[1]=p2Keys;
const keyCodes = {ArrowUp:265,ArrowDown:264,ArrowLeft:263,ArrowRight:262,KeyZ:90,KeyX:88,ShiftLeft:340,Escape:256,Enter:257};
const held = new Set();
let emulator, oldP1=0, lastTick=-1, lastAlive=0, lastUI=0, patch, runConfig;
const names = ['灵梦','魔理沙','魅魔','幽香'];
const status = text => { $('status').textContent=text; };

function nativeKey(code, down) {
  if (!emulator) return;
  emulator.key(keyCodes[code],down);
}
function bits(mapping) {
  let n=0;for(const key of held)n|=mapping[key]||0;
  if((n&3)===3)n&=~3;if((n&12)===12)n&=~12;return n;
}
function inputs() {
  const state=readState(),p=state?.players[touchSlot];
  player.setActive(!!emulator&&['running','paused'].includes(emulator.state));
  player.setContext({key:`${state?.generation||0}:${emulator?.state==='paused'||state?.nativePaused||state?.players?.every(p=>p.ghost)?'menu':'play'}`,play:emulator?.state==='running'&&!state?.nativePaused&&!!p&&!p.ghost&&!p.miss&&!p.entry});
  // A UI refresh may run at 144 Hz while the native game runs at 56.4 Hz.
  // Hold button pulses across one native tick, and send drag deltas only once.
  let movement=touchValue;
  const menu=emulator?.state==='paused'||state?.nativePaused||state?.players?.every(p=>p.ghost);
  if(state&&(state.ticks!==touchTick||menu)){
    touchTick=state.ticks;touchButtons=player.sample(0);
    if(touchButtons&128){player.consume();togglePause();return;}
    if(menu&&touchButtons){menuPulse=touchButtons;menuPulseUntil=performance.now()+80;}
    touchValue=player.pack(touchButtons);movement=touchValue;player.consume();
  }else{
    const t=unpackTouch(touchValue);movement=packTouch(touchButtons,{...t,x:0,y:0,alwaysPoint:Math.floor(touchValue/ALWAYS_POINT)%2===1});
  }
  const sampled=player.sample(bits(mappings[touchSlot])|touchButtons|(menu&&performance.now()<menuPulseUntil?menuPulse:0),{rescueTap:touchButtons&64});
  movement=movement-movement%4096+sampled;
  const values=mappings.map((mapping,slot)=>slot===touchSlot?sampled:bits(mapping));
  const a=values[0];
  for(const [key,bit]of Object.entries(p1Keys))if(key!=='ShiftRight'&&((a^oldP1)&bit))nativeKey(key,!!(a&bit));
  oldP1=a;
  if(emulator)emulator.inputs({p2:values[1]&63,slow:!!(values[1]&64),p3:values[2]&63,slow3:!!(values[2]&64),invincible:$('invincible').checked,touch:values.map((_,i)=>i===touchSlot?movement:0)});

}
function release(){held.clear();player.reset();touchButtons=touchValue=menuPulse=0;menuPulseUntil=0;touchTick=-1;inputs();}
function form(target){return target?.closest?.('select,input,textarea,button');}
for(const type of ['keydown','keyup'])window.addEventListener(type,e=>{
  if(!emulator||e.ctrlKey||e.metaKey||e.altKey)return;
  e.stopImmediatePropagation();
  if(form(e.target)&&!held.has(e.code))return;
  if(mappings.some(mapping=>e.code in mapping)){e.preventDefault();type==='keydown'?held.add(e.code):held.delete(e.code);inputs();}
},true);
window.addEventListener('blur',release);
document.addEventListener('visibilitychange',()=>{if(document.hidden){release();if(emulator?.state==='running'&&readState())emulator.gamePause({onlyPause:true});}});
document.addEventListener('focusin',e=>{if(form(e.target))release();});
$('canvas').onpointerdown=()=>$('canvas').focus();
for(const b of document.querySelectorAll('[data-key]'))b.onclick=async()=>{
  $('canvas').focus();nativeKey(b.dataset.key,true);await new Promise(r=>setTimeout(r,120));nativeKey(b.dataset.key,false);
};

export function readState(){return emulator?.readState()||null;}
function frame(now){
  requestAnimationFrame(frame);if(!emulator||['failed','stopped'].includes(emulator.state))return;
  inputs();
  const s=readState();
  $('pause').disabled=!s;$('pause').textContent=s?.nativePaused?'继续游戏':'暂停游戏';
  if(s&&s.ticks!==lastTick){lastTick=s.ticks;lastAlive=now;}
  const live=!!s&&now-lastAlive<1000;
  for(const id of ['p1','p2','p3']){
    const tag=$(id);tag.hidden=!live||!s?.[id];
    if(live&&s[id]){const canvas=$('canvas'),screen=$('screen'),box=canvas.getBoundingClientRect(),parent=screen.getBoundingClientRect();
      tag.style.left=`${box.left-parent.left+(s[id][0]+32)*box.width/640}px`;
      tag.style.top=`${box.top-parent.top+(s[id][1]-10)*box.height/400}px`;}
  }
  if(now-lastUI>500){lastUI=now;
    $('diagnostics').textContent=s?JSON.stringify({...s,music:emulator.musicError||emulator.bgm?.status},null,2):'正在初始化关卡，请稍候。';
    player.diagnostics($('diagnostics').textContent);
    if(s?.nativePaused)status('游戏暂停菜单：方向键选择，Z / Enter 确认，Esc 继续；选择退出结束本局。');
    else if(live&&emulator.state==='running')status(`本机 ${s.players.length} 人运行中 · ${runConfig.players.map((p,i)=>`P${i+1} ${names[p.character]}`).join(' / ')} · ${s.invincible?'测试无敌已开启':'正常受击'} · ${s.players.map((p,i)=>`P${i+1} ${p.ghost?'幽灵':`残机 ${Math.max(0,p.lives-1)}`} / Bomb ${p.bombs} / P ${p.power}/128${p.rescue?` / 救援 ${p.rescue}/5`:''}`).join(' · ')}`);
  }
}
requestAnimationFrame(frame);
$('start').onclick=async()=>{
  runConfig={rank:Number($('rank').value),players:Array.from({length:Number($('players').value)},(_,i)=>i+1).map(i=>({character:Number($('character'+i).value),spares:Number($('spares').value),bombs:Number($('bombs').value)}))};
  $('start').disabled=true;$('language').disabled=true;
  document.querySelectorAll('[data-config]').forEach(el=>el.disabled=true);
  try{
    const coreTask=prepareFastCore();coreTask.catch(()=>{});
    const lang=$('language').value;status('正在校验并加载实验磁盘…');
    const response=await fetch(`patch-${lang}.json`,{cache:'no-store'});if(!response.ok)throw Error('磁盘清单读取失败');
    patch=await response.json();
    const data=await loadVerifiedBytes(new URL(`th05-local-${lang}.hdi.gz`,import.meta.url),patch.sha256,{gzip:true,size:patch.size});
    installConfig(data,patch,runConfig);
    const params=new URLSearchParams(location.search);
    emulator=await createFastCore({canvas:$('canvas'),disk:data,patch,qa:qaEnabled,coreTask,
      core:qaEnabled?(params.get('core')||'simple'):'simple',cycles:qaEnabled?(params.get('cycles')||'max 100%'):'max 100%',
      presentation:qaEnabled?(params.get('presentation')||'bitmap'):'bitmap',viewSlot:Number($('score-seat').value)});
    emulator.onError=e=>{status('游戏运行失败：'+e.message);$('pause').disabled=true;};
    emulator.onExit=endSession;
    emulator.bgm.setVolume(Number($('bgm-volume').value)/100);player.setLabel(`触摸控制 P${touchSlot+1}`);
    $('pause').disabled=false;$('canvas').focus();status('正在直接进入关卡，无需操作原版菜单。');
  }catch(e){status(`启动失败：${e.message}`);console.error(e);}
};
function togglePause(){
  if(emulator?.state!=='running'||!readState())return;
  release();emulator.gamePause();$('canvas').focus();
}
function endSession(){
  emulator?.stop();emulator=null;release();player.setActive(false);player.exit();
  for(const id of ['p1','p2','p3'])$(id).hidden=true;
  $('pause').disabled=true;$('start').disabled=false;$('language').disabled=false;
  document.querySelectorAll('[data-config]').forEach(el=>el.disabled=false);
  const canvas=$('canvas'),blank=canvas.cloneNode(false);blank.onpointerdown=()=>blank.focus();canvas.replaceWith(blank);
  status('已退出模拟器，本局结束。可重新选择设置并进入关卡。');
}
$('pause').onclick=togglePause;
$('restart').onclick=()=>location.reload();
$('fullscreen').onclick=()=>player.enter();
$('touch-seat').onchange=()=>{release();touchSlot=Number($('touch-seat').value);player.setLabel(`触摸控制 P${touchSlot+1}`);};
$('score-seat').onchange=()=>emulator?.viewSlot(Number($('score-seat').value));
$('bgm-volume').oninput=()=>emulator?.bgm?.setVolume(Number($('bgm-volume').value)/100);
$('capture').onclick=async()=>{try{const blob=await emulator.capture(),url=URL.createObjectURL(blob),a=document.createElement('a');a.download='th05-fast.png';a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){status('保存画面失败：'+e.message);}};

// Explicit local QA only; never enabled during ordinary play.
if(qaEnabled)window.th05QA={readState,get emulator(){return emulator;},get patch(){return patch;},command:(action,props)=>emulator.qa(action,props)};

function updateSeats(){
  const count=Number($('players').value);$('p3-config').hidden=count<3;
  $('touch-seat').querySelector('[value="2"]').hidden=count<3;
  $('score-seat').querySelector('[value="2"]').hidden=count<3;
  if(Number($('score-seat').value)>=count){$('score-seat').value='0';emulator?.viewSlot(0);}
  if(touchSlot>=count){release();touchSlot=0;$('touch-seat').value='0';player.setLabel('触摸控制 P1');}
}
$('players').onchange=updateSeats;updateSeats();
