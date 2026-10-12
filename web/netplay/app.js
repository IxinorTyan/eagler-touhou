import {NetSession} from './session.js';
import {createCoopFeedback} from '../coop.js';
import {mountTouchControls} from '../touch-controls.js';
import {nextPerformanceMode,performanceModeLabel} from '../performance-mode.js';
import {mountBossBalance,bossBalanceText} from '../boss-balance.js';
import {mountLifeCompensation,lifeCompensationText} from '../life-compensation.js';
import {readNetworkMode,describeNetwork,networkParams} from './network-mode.js';
import '../site-ui.js';
const $=id=>document.getElementById(id),roles=['host','guest','guest2'];
const savedMusicVolume=Number(localStorage.getItem('th01-net-music-volume')??70);
$('music-volume').value=String(Number.isFinite(savedMusicVolume)?Math.max(0,Math.min(100,savedMusicVolume)):70);
$('music-volume').oninput=()=>{localStorage.setItem('th01-net-music-volume',$('music-volume').value);session?.game.setMusicVolume(Number($('music-volume').value)/100);};
const updateBossBalance=mountBossBalance({getSettings:()=>({players:Number($('players').value),count:Number($('count').value)})});
const updateLifeCompensation=mountLifeCompensation();
let identity,room,session,polling=false,leaving=false,busy=false,editing=false,capabilities;
const initialMode=readNetworkMode();
for(const id of ['network','transport','ice'])$(id).value=initialMode[id];
$('code').value=new URLSearchParams(location.search).get('room')?.match(/^\d{4}$/)?.[0]||'';
function networkPresentation(value){
  const pub=value.network==='public',rtc=value.transport==='rtc';
  $('mode-title').textContent=pub?'公网联机':'局域网联机';
  document.title=`TH01 · ${pub?'公网':'局域网'}联机`;
  for(const id of ['lan-link','public-link'])$(id).removeAttribute('aria-current');
  $(pub?'public-link':'lan-link').setAttribute('aria-current','page');
  $('ice-field').hidden=!pub||!rtc;
  $('mode-note').textContent=pub?'优先 UDP 打洞，可选 TURN 中继或 TCP 转发。':'同一局域网内默认 UDP 直连。';
  $('network-help').textContent=pub?'全员打开同一个公网 HTTPS 地址。自动模式使用 STUN 打洞，配置 TURN 后可兜底；输入缓冲默认在开局时测量并选择，三人模式计入经房主转发的延迟。公网隧道只提供网页与信令入口，打洞失败可重建房间改用 TURN 或 TCP 转发。':'全员打开服务窗口里的同一个局域网地址，输入缓冲默认在开局时测量并选择。';
  $('network-capabilities').textContent=!pub?'':!capabilities?'正在检查公网打洞配置…':`STUN：${capabilities.publicStunCount?'已启用':'未配置'} · TURN：${capabilities.turnConfigured?'已配置（开始连接时验证）':'未配置；自动模式仍会尝试直接打洞，强制 TURN 需先运行 configure-turn.bat'}`;
  $('retry-turn').hidden=!pub||!capabilities?.turnConfigured;
}
networkPresentation(initialMode);
$('transport').onchange=()=>{if($('transport').value==='ws')$('ice').value='all';networkPresentation(config());};
fetch('/api/network',{cache:'no-store'}).then(async response=>{
  if(!response.ok)throw Error('读取公网配置失败');capabilities=await response.json();networkPresentation(room&&!editing?room.settings:config());
}).catch(()=>{$('network-capabilities').textContent='无法检查公网配置，请确认使用当前版本的 start-lan.bat 服务。';});
const keys=new Set(),keyBits={ArrowLeft:1,ArrowRight:2,KeyZ:4,KeyX:8,ArrowUp:16,ArrowDown:32,Enter:64,Escape:128};
let taps=0,commands=0;const feedback=createCoopFeedback();
const status=text=>{$('status').textContent=text;};
const performanceButton=document.createElement('button');performanceButton.id='performance-mode';performanceButton.type='button';performanceButton.textContent=performanceModeLabel();
performanceButton.title='点击切换自动、流畅、省性能。仅调整自己的画面，游戏速度与判定保持。';
$('fullscreen').parentElement.append(performanceButton);
performanceButton.onclick=()=>{const mode=nextPerformanceMode();performanceButton.textContent=performanceModeLabel(mode);session?.game.setPresentationMode(mode);};
function held(){let bits=0;for(const key of keys)bits|=keyBits[key]||0;return bits;}
function buttons(){const bits=held()|taps|commands|touchControls.sample();taps=commands=0;return bits;}
function inputChanged(){session?.pump();}
function clear(){keys.clear();taps=commands=0;touchControls.reset();inputChanged();}
// Register first: the touch controller's blur reset also wakes input sampling.
addEventListener('blur',clear);
const touchControls=mountTouchControls({player:$('player'),screen:$('screen'),canvas:$('canvas'),
  toolbar:$('fullscreen').parentElement,fullscreenButton:$('fullscreen'),
  getContext:()=>{
    const state=session?.game.state(),slot=session?.slot??0,p=state?.players?.[slot];
    return {active:!!session?.running,play:[1,2].includes(state?.phase),phase:state?.phase,stage:state?.stage,recovering:state?.recovering,menu:state?.coopMenu>0,
      key:`${slot}:${state?.stage??0}:${state?.phase??'boot'}`,slot,left:p?.left,ghost:p?.ghost,bombs:p?.bombs,canMenu:identity?.role==='host'};
  },onChange:inputChanged,onGesture:()=>session?.game.unlockAudio()});
addEventListener('keydown',e=>{
  if(!session||e.target.closest('input,select,textarea')||!keyBits[e.code])return;
  e.preventDefault();e.stopImmediatePropagation();
  if(!keys.has(e.code)){taps|=keyBits[e.code];keys.add(e.code);inputChanged();}
},true);
addEventListener('keyup',e=>{
  if(!keyBits[e.code])return;
  const changed=keys.delete(e.code);if(session){e.preventDefault();e.stopImmediatePropagation();if(changed)inputChanged();}
},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();session?.game.emulator?.module.netFlushAudio();}});
document.addEventListener('focusin',e=>{if(e.target.closest('input,select,textarea'))clear();});
async function post(action,data={}){
  const response=await fetch(`/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...identity,...data})});
  const value=await response.json();if(!response.ok)throw Error(value.error||'房间请求失败');return value;
}
function config(){const network=$('network').value,transport=$('transport').value;return {players:Number($('players').value),rank:Number($('rank').value),count:Number($('count').value),lifeCompensation:$('life-compensation').checked,transport,network,ice:network==='public'&&transport==='rtc'?$('ice').value:'all',delay:Number($('delay').value)};}
function showRoom(value){
  room=value;editing=editing&&room.phase==='lobby';$('entry').hidden=!editing;$('lobby').hidden=false;
  if(!editing){for(const id of ['network','ice','transport'])$(id).value=room.settings[id]??(id==='network'?'lan':id==='ice'?'all':room.transport);networkPresentation(config());}
  const host=identity.role==='host',lobby=room.phase==='lobby';
  $('room-title').textContent=`合作房间 · 你是 P${room.seats[identity.role]+1}${host?'（房主）':''}`;
  $('room-code').textContent=room.room;
  $('room-settings').textContent=`${['Easy','Normal','Hard','Lunatic'][room.settings.rank]} · ${room.settings.players} 人 · ${room.settings.count} 玉 · ${bossBalanceText(room.settings.players,room.settings.count)} · ${lifeCompensationText(room.settings.count,room.settings.lifeCompensation??true)} · 允许续关 · ${describeNetwork({...room.settings,transport:room.transport})} · ${room.settings.delay===0?'自动输入缓冲':`缓冲 ${room.settings.delay} 帧`}`;
  $('members').dataset.players=room.settings.players;
  $('members').replaceChildren(...roles.slice(0,room.settings.players).map(role=>{
    const card=document.createElement('article');card.className='seat-card';
    card.dataset.local=role===identity.role;card.dataset.ready=!!room.ready[role];card.dataset.present=!!room.present[role];
    const kicker=document.createElement('span');kicker.className='section-kicker';kicker.textContent=`PLAYER 0${room.seats[role]+1}`;
    const title=document.createElement('strong');title.textContent=`P${room.seats[role]+1} · ${role==='host'?'房主':'队友'}${role===identity.role?' · 你':''}`;
    const state=document.createElement('span');state.className='seat-state';state.textContent=room.present[role]?(room.ready[role]?'已准备':'未准备'):'等待加入';
    card.append(kicker,title,state);return card;
  }));
  $('swap').disabled=$('settings').disabled=!host||!lobby;
  $('ready').disabled=!lobby;$('ready').textContent=room.ready[identity.role]?'取消准备':'准备';
  $('start').disabled=!host||!lobby||!roles.slice(0,room.settings.players).every(r=>room.present[r]&&room.ready[r]);
  $('seat-note').textContent=`你操作 P${room.seats[identity.role]+1} · ${host?'你负责菜单选择和续关':'菜单选择由房主操作'}`;
}
async function accept(value){
  if(!identity)identity={room:value.room,role:value.role,token:value.token};
  showRoom(value);
  if(room.ended&&session&&!session.closed){session.fail(Error(room.ended),false);return;}
  if(room.phase==='loading'&&!session){
    clear();$('cover').hidden=true;
    session=new NetSession(identity,room,{canvas:$('canvas'),api:post,status,buttons,render,failure});
    session.game.setMusicVolume?.(Number($('music-volume').value)/100);
    session.game.onMusicStatus=text=>{$('music-status').textContent=text;};
    window.th01Net={get session(){return session;},get room(){return room;},
      ...(room.settings.qa&&identity.role==='host'?{qa(bit){commands|=bit;inputChanged();}}:{})};
    try{await session.prepare();}catch(error){session.fail(error);return;}
  }
  for(const message of value.signals||[])await session?.receiveSignal(message);
}
function failure(reason,current){
  touchControls.reset();touchControls.refresh();
  status(reason);$('fallback').hidden=false;$('connection').textContent=current.connectionText();
  $('runtime').textContent+=current.diagnostic?'\n'+JSON.stringify(current.diagnostic):'';
}
function render(current){
  touchControls.refresh();
  const state=current.game.state(),events=feedback(state,performance.now());
  $('connection').textContent=current.connectionText();
  $('runtime').dataset.state=JSON.stringify(state);
  $('runtime').textContent=`确认步 ${current.queue.frame} · 最近一致摘要 ${current.lastHash}${current.waitHash?' · 等待状态核对':''}\n${state?`第 ${state.stage} 关 · ${state.count} 玉 · ${state.phase===1?'等待开球':state.phase===2?'进行中':state.phase===3?'原作暂停':'菜单 / 过场'}`:'正在启动 DOS / 原作菜单'}`;
  $('coop-hud').hidden=!state?.players;
  for(let i=0;i<3;i++){
    $(`p${i+1}-hud`).hidden=!state?.players?.[i];
    if(!state?.players?.[i])continue;
    const p=state.players[i],event=events[i],hud=$(`p${i+1}-hud`);
    hud.textContent=`P${i+1}${current.slot===i?'（你）':''} · ${p.ghost?'幽灵：碰活队友复活':`残机 ${p.lives} · Bomb ${p.bombs}${p.invincibility?` · 保护 ${(p.invincibility/56.4).toFixed(1)}s`:''}`}${event?' · '+event.text:''} · 获救 ${p.rescues}`;
    hud.classList.toggle('hit-feedback',!!event?.hit);
  }
  $('continue-game').hidden=identity.role!=='host'||state?.coopMenu!==3||state.phase!==0;
  $('menu-note').textContent=state?.phase===0&&state.coopMenu===2?'成绩登记：房主按确认后进入续关。':state?.phase===0&&state.coopMenu===3?'全员已阵亡，可不限次数续关；房主点击“全员续关”恢复各自初始残机（含补偿）和 Bomb。':'';
}
async function poll(){
  if(polling||!identity||leaving)return;
  polling=true;
  try{
    const response=await fetch('/api/events?'+new URLSearchParams({room:identity.room,token:identity.token}),{cache:'no-store'});
    const value=await response.json();if(!response.ok)throw Error(value.error||'房间服务不可用');
    await accept(value);
    if(session&&!session.closed){
      if(!session.running)$('connection').textContent=session.connectionText();
      else status(session.waitingText());
    }
  }catch(error){if(session&&!session.closed)session.fail(error);else status(error.message);}
  finally{polling=false;}
}
async function action(fn){if(busy)return;busy=true;try{await fn();}catch(error){status(error.message);}finally{busy=false;}}
$('create').onclick=()=>action(async()=>{await accept(await post('create',{settings:config()}));status('房间已创建，让队友在同一游戏网址输入四位房间号');});
$('join').onclick=()=>action(async()=>{await accept(await post('join',{room:$('code').value.trim()}));status('已加入房间，确认设置后准备');});
$('ready').onclick=()=>action(async()=>accept(await post('ready',{ready:!room.ready[identity.role]})));
$('start').onclick=()=>action(async()=>accept(await post('start')));
$('swap').onclick=()=>action(async()=>accept(await post('seat')));
$('settings').onclick=()=>{
  const configPanel=$('entry');editing=!editing;configPanel.hidden=!editing;
  for(const id of ['players','rank','count','transport','delay','network','ice'])$(id).value=String(room.settings[id]??(id==='network'?'lan':'all'));
  $('life-compensation').checked=room.settings.lifeCompensation??true;
  updateBossBalance();updateLifeCompensation();networkPresentation(config());
  $('create').hidden=$('join').hidden=$('code').parentElement.hidden=true;
  $('entry-actions').hidden=true;
  if(!document.getElementById('save-settings')){
    const button=document.createElement('button');button.id='save-settings';button.textContent='保存房间设置';
    button.onclick=()=>action(async()=>{const value=await post('settings',{settings:config()});editing=false;await accept(value);});configPanel.append(button);
  }
};
$('continue-game').onclick=()=>{commands|=256;$('canvas').focus();inputChanged();};
async function returnToEntry(mode=room.settings){
  leaving=true;session?.close();
  try{await post('leave');}finally{identity=null;location.href='lan.html?'+networkParams(mode);}
}
$('leave').onclick=()=>action(()=>returnToEntry());
$('retry').onclick=()=>action(()=>returnToEntry());
$('retry-turn').onclick=()=>action(()=>returnToEntry({...room.settings,network:'public',transport:'rtc',ice:'relay'}));
$('retry-ws').onclick=()=>action(()=>returnToEntry({...room.settings,transport:'ws',ice:'all'}));
$('sound').onclick=()=>action(async()=>{if(!session?.game.emulator)throw Error('游戏尚未加载');await session.game.unlockAudio();$('sound').textContent='声音已启用';$('canvas').focus();});
$('canvas').onpointerdown=()=>{$('canvas').focus();session?.game.unlockAudio().catch(()=>{});};
addEventListener('pagehide',()=>{
  session?.close();
  if(identity)navigator.sendBeacon('/api/leave',new Blob([JSON.stringify(identity)],{type:'application/json'}));
});
setInterval(poll,250);
