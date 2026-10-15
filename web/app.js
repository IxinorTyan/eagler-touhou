import {DOSBoxPC98} from './dosbox-adapter.js';
import {sha256} from './netplay/sha256.js';
import {installQA} from './qa.js';
import {createCoopControls,createCoopFeedback,readCoopState,coopInputOffset} from './coop.js';
import {mountTouchControls} from './touch-controls.js';
import {TOUCH_BOMB,readHitRecovery} from './touch-input.js';
import {createPresentationLimiter,nextPerformanceMode,performanceModeLabel} from './performance-mode.js';
import {createFrameGate} from './frame-limit.js';
import {mountBossBalance,bossBalanceText} from './boss-balance.js';
import {mountLifeCompensation,lifeCompensationText} from './life-compensation.js';
import './site-ui.js';
const $=id=>document.getElementById(id);
const baseline=new URLSearchParams(location.search).get('baseline')==='1';
const solo=document.body.dataset.page==='solo';
if(new URLSearchParams(location.search).get('qa')==='1')document.querySelector('.debug-disclosure').open=true;
let emulator,manifest,busy=false;
const presentation=createPresentationLimiter();
const pollDue=createFrameGate();let hudAt=-Infinity;
let bridge=-1,scanCursor=0,candidates=[],lastPoll=0,pendingSkip=null;
const bridgeHistory=new Map();let lastBridgeProgress=-Infinity;
let testInvincible=false;
let sessionSettings=null;
let lastScan=-Infinity,perfAt=0,perfFrame=0,perfPresented=0,perfGame=null,perfSamples=[],perfReport=null;
const signature=new TextEncoder().encode('TH01ORB-LAB-v03!');
let touchControls,touchSlot=0,touchNativeBits=0;
const physicalHeld=new Set();
const touchNativeDeadlines=new Map();
for(const id of ['rank','count','players']){
  const storageId=solo&&id==='count'?'solo-count':id;
  const saved=localStorage.getItem(`th01-multiorb-${storageId}`);
  if([...$(id).options].some(option=>option.value===saved))$(id).value=saved;
  $(id).addEventListener('change',()=>localStorage.setItem(`th01-multiorb-${storageId}`,$(id).value));
}
if(solo){$('players').value='1';$('players').disabled=true;}
const updateLifeCompensation=mountLifeCompensation({remember:true,key:solo?'th01-solo-life-compensation':'th01-local-life-compensation'});
const updateBossBalance=mountBossBalance({getSettings:()=>({players:baseline?1:Number($('players').value),count:baseline?1:Number($('count').value)})});
function updateSetup(){
  updateBossBalance();
  updateLifeCompensation();
  const debugging=!baseline&&$('debug-enabled').checked;
  $('debug-options').hidden=!debugging;
  $('test-invincible').disabled=!debugging||busy;
  $('setup-summary').textContent=`本次启用 ${baseline?1:$('count').value} 玉 · ${debugging?'调试开启':'调试关闭'} · ${debugging&&$('test-invincible').checked?'玩家无敌':'正常受伤'}`;
}
for(const id of ['players','count','debug-enabled','test-invincible'])$(id).addEventListener('change',updateSetup);
function status(message){$('status').textContent=message;}
const performanceButton=document.createElement('button');performanceButton.id='performance-mode';performanceButton.type='button';performanceButton.textContent=performanceModeLabel();
performanceButton.title='点击切换自动、流畅、省性能。省性能降低画面刷新，游戏速度与判定保持。';
$('fullscreen').parentElement.append(performanceButton);
performanceButton.onclick=()=>{const mode=nextPerformanceMode();presentation.setMode(mode);performanceButton.textContent=performanceModeLabel(mode);};
function releaseInputs(){touchControls?.reset();coopControls.release();}
let coopSampleKey='';
const coopFeedback=createCoopFeedback();
const coopControls=createCoopControls({enabled:()=>sessionSettings?.players>1,count:()=>sessionSettings?.players||2,
  menu:()=>![1,2].includes(nativeState()?.phase),write:buttons=>{
    if(!emulator||bridge<0||!(sessionSettings?.players>1))return;
    const view=new DataView(emulator.module.HEAPU8.buffer);
    for(let i=0;i<sessionSettings.players;i++)view.setUint16(bridge+coopInputOffset(i),buttons[i],true);
  }});
const keyCodes={ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,KeyZ:90,KeyX:88,Enter:13,Escape:27};
function key(code,down){$('canvas').dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code,keyCode:keyCodes[code],which:keyCodes[code],bubbles:true}));}
const touchKeyBits={ArrowLeft:1,ArrowRight:2,KeyZ:4,KeyX:8,ArrowUp:16,ArrowDown:32,Enter:64,Escape:128};
function syncTouchInputs(){
  if(!touchControls)return;
  const bits=touchControls.sample(),state=nativeState(),coop=sessionSettings?.players>1;
  if(coop){
    const external=Array(sessionSettings.players).fill(0);external[touchSlot]=(bits&15)|((bits&TOUCH_BOMB)?16:0);
    coopControls.setExternal(external);
  }else if((bits&TOUCH_BOMB)&&!baseline&&state?.phase===2&&bridge>=0){
    const view=new DataView(emulator.module.HEAPU8.buffer);
    view.setUint16(bridge+182,view.getUint16(bridge+182,true)|16,true);
  }
  let nativeBits=coop&&[1,2].includes(state?.phase)?bits&128:bits&255;
  // Native menus / solo keyboard polling may miss a tap shorter than one game
  // frame. Hold action edges briefly, while movement still releases at once.
  const now=performance.now();
  for(const bit of [4,8,16,32,64,128]){
    if((nativeBits&bit)&&!(touchNativeBits&bit))touchNativeDeadlines.set(bit,now+90);
    if((touchNativeDeadlines.get(bit)||0)>now)nativeBits|=bit;
    else touchNativeDeadlines.delete(bit);
  }
  for(const [code,bit]of Object.entries(touchKeyBits)){
    if((nativeBits&bit)===(touchNativeBits&bit))continue;
    if((nativeBits&bit)||!physicalHeld.has(code))key(code,!!(nativeBits&bit));
  }
  touchNativeBits=nativeBits;
}
touchControls=mountTouchControls({player:$('player'),screen:$('screen'),canvas:$('canvas'),
  toolbar:$('fullscreen').parentElement,fullscreenButton:$('fullscreen'),getContext:()=>{
    const state=nativeState(),p=state?.players?.[touchSlot];
    return {active:emulator?.state==='running',play:[1,2].includes(state?.phase),phase:state?.phase,stage:state?.stage,recovering:state?.recovering,menu:state?.coopMenu>0,
      key:`${touchSlot}:${state?.stage??0}:${state?.phase??'boot'}`,slot:touchSlot,
      left:p?.left??state?.playerLeft,ghost:p?.ghost,bombs:baseline?0:p?.bombs??state?.playerBombs,
      canMenu:true,players:sessionSettings?.players,localCoop:sessionSettings?.players>1};
  },onSelectSlot:slot=>{coopControls.release();touchSlot=slot;syncTouchInputs();},
  onReset:()=>touchNativeDeadlines.clear(),onChange:syncTouchInputs,onGesture:()=>emulator?.module.SDL2?.audioContext?.resume()});
addEventListener('keydown',event=>{if(event.isTrusted&&touchKeyBits[event.code])physicalHeld.add(event.code);},true);
addEventListener('keyup',event=>{
  if(!event.isTrusted||!touchKeyBits[event.code])return;physicalHeld.delete(event.code);
  if(touchNativeBits&touchKeyBits[event.code])queueMicrotask(()=>{if(touchNativeBits&touchKeyBits[event.code])key(event.code,true);});
},true);
addEventListener('blur',()=>physicalHeld.clear());
addEventListener('blur',releaseInputs);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseInputs();});
document.addEventListener('keydown',event=>{if(emulator&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','Escape'].includes(event.code))event.preventDefault();});
$('start').addEventListener('click',async()=>{
  if(busy||emulator)return;busy=true;$('start').disabled=true;
  sessionSettings={rank:Number($('rank').value),count:baseline?1:Number($('count').value),players:baseline||solo?1:Number($('players').value),
    lifeCompensation:!baseline&&$('life-compensation').checked,
    debug:!baseline&&$('debug-enabled').checked,invincible:!baseline&&$('debug-enabled').checked&&$('test-invincible').checked};
  testInvincible=sessionSettings.invincible;
  for(const id of ['rank','count','players','life-compensation','debug-enabled','test-invincible'])$(id).disabled=true;
  try{
    status('正在加载游戏…');
    const response=await fetch(baseline?'baseline.json':'th01-multiorb.json');
    if(!response.ok)throw Error('游戏镜像尚未构建。请先运行构建脚本。');
    manifest=await response.json();
    const diskResponse=await fetch(manifest.url);if(!diskResponse.ok)throw Error('无法读取游戏镜像');
    const disk=new Uint8Array(await new Response(diskResponse.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const hash=await sha256(disk);
    if(hash!==manifest.sha256||disk.length!==manifest.size)throw Error('游戏镜像校验失败');
    disk[manifest.configuration['REIIDEN/REIIDEN.CFG'].offset+7]=sessionSettings.rank;
    disk[manifest.configuration['REIIDEN/ORBS.CFG'].offset]='0'.charCodeAt(0)+sessionSettings.count;
    if(manifest.configuration['REIIDEN/COOP.CFG'])disk[manifest.configuration['REIIDEN/COOP.CFG'].offset]=48+sessionSettings.players;
    if(!baseline){
      const startConfig=manifest.configuration['REIIDEN/START.CFG'];
      if(!startConfig)throw Error('游戏镜像需要更新，缺少直接开局配置');
      disk[startConfig.offset]=solo?50:49;
      const lifeConfig=manifest.configuration['REIIDEN/LIVES.CFG'];
      if(!lifeConfig)throw Error('游戏镜像需要更新，缺少生命补偿配置');
      disk[lifeConfig.offset]=sessionSettings.lifeCompensation?49:48;
    }
    emulator=await DOSBoxPC98.create({canvas:$('canvas'),onExit:()=>status('模拟器已关闭'),onError:error=>status(error.message)});
    emulator.module.observeLocalFrame=ms=>{perfSamples.push(ms);if(perfSamples.length>240)perfSamples.shift();};
    // DOSBox submits completed raster frames. The guest can already be drawing
    // the next frame at that instant; its old NP21 busy flag can suppress every
    // submission on a slow device. Limit presentation by completed submissions.
    emulator.module.shouldPresentFrame=()=>presentation.allow(performance.now(),emulator.module.frameUploads);
    emulator.addDiskImage('th01.hdi',disk);await emulator.setHdd(0,'th01.hdi');emulator.run();
    $('cover').hidden=true;$('setup').hidden=true;$('rank').disabled=true;$('count').disabled=true;
    $('pause').disabled=false;$('restart').disabled=false;$('canvas').focus();
    status(baseline?'源码基线运行中':'DOSBox-X 游戏运行中');
    updateSessionSettings();
    $('diagnostics').textContent=`模式：${baseline?'源码基线':'多玉'}\n源码：ReC98 debloated ${manifest.upstream.commit}\n编译器：${manifest.compiler}\n程序 SHA-256：${manifest.exe_sha256}\n本次难度：${$('rank').selectedOptions[0].textContent}\n本次玉数：${baseline?1:$('count').value}`;
    window.th01Lab={emulator,manifest};
    requestAnimationFrame(poll);
  }catch(error){emulator?.dispose();emulator=null;status(error.message);$('start').disabled=false;busy=false;
    $('rank').disabled=false;$('players').disabled=baseline||solo;$('count').disabled=baseline;$('life-compensation').disabled=baseline;$('debug-enabled').disabled=baseline;updateSetup();console.error(error);}
});
$('pause').addEventListener('click',()=>{releaseInputs();if(emulator?.state==='running'){emulator.pause();$('pause').textContent='继续模拟器';status('模拟器已暂停');}else if(emulator){emulator.run();$('pause').textContent='暂停模拟器';status('DOSBox-X 游戏运行中');$('canvas').focus();}});
$('restart').addEventListener('click',()=>{releaseInputs();location.reload();});
$('runtime-invincible').addEventListener('change',()=>setInvincible($('runtime-invincible').checked));
for(let slot=0;slot<3;slot++)$(`test-p${slot+1}-ghost`).addEventListener('click',()=>{
  const state=nativeState();
  if(!sessionSettings?.debug||sessionSettings.players<2||state?.phase!==2||!state.players?.[slot]||state.players[slot].ghost)return;
  const view=new DataView(emulator.module.HEAPU8.buffer);
  view.setUint16(bridge+140,view.getUint16(bridge+140,true)|(2<<slot),true);
  $('canvas').focus();
});
if(baseline){$('players').value='1';$('players').disabled=true;$('count').value='1';$('count').disabled=true;$('life-compensation').checked=false;$('life-compensation').disabled=true;$('debug-enabled').disabled=true;$('launch-note').textContent='验证 ReC98 源码重建的一玉基线。';}
updateSetup();

function nativeState(){
  if(!emulator||bridge<0)return null;
  const heap=emulator.module.HEAPU8,v=new DataView(heap.buffer),at=bridge;
  if(!signature.every((byte,i)=>heap[at+i]===byte))return null;
  const phase=v.getUint16(at+18,true),stage=v.getUint16(at+24,true),count=v.getUint16(at+26,true);
  if(v.getUint16(at+16,true)!==3||phase>3||stage<1||stage>20||![1,2,3,4,6,8].includes(count))return null;
  const balls=[];
  for(let i=0;i<Math.min(count,8);i++){
    const pos=at+44+i*12;
    balls.push({x:v.getInt16(pos,true),y:v.getInt16(pos+2,true),vx:v.getInt16(pos+4,true)/256,vy:v.getInt16(pos+6,true)/256,portal:!!v.getUint16(pos+8,true)});
  }
  return {phase,stage,count,recovering:!baseline&&readHitRecovery(v,at,manifest?.touch_state),ticks:v.getUint32(at+20,true),ack:v.getUint16(at+32,true),launchAge:v.getUint16(at+34,true),collisions:v.getUint32(at+36,true),armedPairs:v.getUint32(at+40,true),invincible:!!v.getUint16(at+142,true),balls,players:baseline?null:readCoopState(v,at),playerLeft:baseline?undefined:v.getInt16(at+186,true),playerBombs:baseline?undefined:v.getInt16(at+190,true),coopMenu:baseline?0:v.getUint16(at+210,true),continueRequested:baseline?false:!!v.getUint16(at+212,true),
    samples:baseline?0:v.getUint32(at+214,true),profile:Array.from({length:7},(_,i)=>v.getUint32(at+146+i*4,true)),cardHits:v.getUint32(at+174,true),activeItems:v.getUint16(at+178,true)};
}

function scanBridge(now){
  const heap=emulator.module.HEAPU8,v=new DataView(heap.buffer);
  candidates=candidates.filter(at=>signature.every((byte,i)=>heap[at+i]===byte));
  const valid=at=>candidates.includes(at)&&v.getUint16(at+16,true)===3&&v.getUint16(at+18,true)<=3&&v.getUint16(at+24,true)>=1&&v.getUint16(at+24,true)<=20&&[1,2,3,4,6,8].includes(v.getUint16(at+26,true));
  const advancing=candidates.filter(at=>{
    const ticks=v.getUint32(at+20,true),previous=bridgeHistory.get(at);
    bridgeHistory.set(at,ticks);
    return valid(at)&&v.getUint16(at+18,true)>0&&previous!==undefined&&ticks>previous;
  });
  // DOS may leave old data copies behind when switching game programs.
  // Prove activity by counter progress, and keep the current bridge through
  // phase 0 rather than replacing it with an old phase-2 memory image.
  if(advancing.includes(bridge))lastBridgeProgress=now;
  else if(advancing.length===1){bridge=advancing[0];lastBridgeProgress=now;}
  else if(!valid(bridge))bridge=-1;
  if(bridge<0||now-lastBridgeProgress>500){
    if(scanCursor>=heap.length)scanCursor=0;
    const end=Math.min(scanCursor+2*1024*1024,heap.length),slice=heap.subarray(scanCursor,Math.min(end+signature.length-1,heap.length));
    for(let offset=slice.indexOf(signature[0]);offset>=0&&scanCursor+offset<end;offset=slice.indexOf(signature[0],offset+1)){
      const at=scanCursor+offset;
      if(at+180<=heap.length&&signature.every((byte,i)=>heap[at+i]===byte)&&!candidates.includes(at))candidates.push(at);
    }
    scanCursor=end;
  }
}

function poll(now){
  if(!emulator)return;
  if(!pollDue(now)){requestAnimationFrame(poll);return;}
  if(now-lastScan>=100){scanBridge(now);lastScan=now;}
  const state=nativeState();
  const sampleKey=state?`${bridge}:${state.stage}:${state.samples}`:'';
  if(sampleKey!==coopSampleKey){coopSampleKey=sampleKey;coopControls.consumed();}
  syncTouchInputs();
  if(now-hudAt>=150){hudAt=now;updateCoopHud(state);}
  syncTestFlags(state);
  if(now-perfAt>=2000){
    const frames=emulator.module.localFrameCount||0,elapsed=(now-perfAt)/1000;
    const sorted=perfSamples.slice().sort((a,b)=>a-b);
    const gameHz=state?.phase===2&&perfGame?.phase===2&&perfGame.stage===state.stage&&state.ticks>=perfGame.ticks?(state.ticks-perfGame.ticks)/elapsed:0;
    const presented=emulator.module.presentedFrameCount||0;
    perfReport={loopHz:(frames-perfFrame)/elapsed,gameHz,presentationHz:(presented-perfPresented)/elapsed,averageMs:perfSamples.length?perfSamples.reduce((a,b)=>a+b,0)/perfSamples.length:0,p95Ms:sorted[Math.floor(sorted.length*.95)]||0,cycles:emulator.module.mobileRuntime.cycles,runtime:emulator.module.mobileRuntime||'dosbox-x'};
    $('runtime').dataset.performance=JSON.stringify(perfReport);
    perfAt=now;perfFrame=frames;perfPresented=presented;perfGame=state?{stage:state.stage,phase:state.phase,ticks:state.ticks}:null;perfSamples=[];
  }
  if(state&&pendingSkip){
    if(state.stage!==pendingSkip.stage){pendingSkip=null;status(`已进入第 ${state.stage} 关`);}
    else if(state.ack===pendingSkip.sequence)status('本关已通过，正在结算…');
  }
  $('skip').disabled=baseline||!state||![1,2].includes(state.phase)||emulator.state!=='running'||!!pendingSkip;
  if(now-lastPoll>200){
    lastPoll=now;
    $('runtime').dataset.state=JSON.stringify(state);
    $('runtime').textContent=state?`第 ${state.stage} 关 · ${state.count} 玉 · ${state.phase===1?'等待发射':state.phase===2?'进行中':'原作暂停'}\n玉间碰撞：${state.collisions} 次 · 已启用玉对：${state.armedPairs.toString(2)}\n${state.balls.map((ball,i)=>`玉 ${i+1}：(${ball.x}, ${ball.y}) · 速度 (${ball.vx.toFixed(2)}, ${ball.vy.toFixed(2)})${ball.portal?' · 传送中':''}`).join('\n')}`:'尚未进入关卡，或正在切换画面。';
    if(perfReport)$('runtime').textContent+=`\n模拟循环 ${perfReport.loopHz.toFixed(1)} Hz · 游戏 ${perfReport.gameHz.toFixed(1)} 帧/秒 · 完整画面 ${perfReport.presentationHz.toFixed(1)} 帧/秒 · 单次模拟平均 ${perfReport.averageMs.toFixed(1)} ms / P95 ${perfReport.p95Ms.toFixed(1)} ms`;
  }
  requestAnimationFrame(poll);
}

$('skip').addEventListener('click',()=>{
  const state=nativeState();
  if(!state||![1,2].includes(state.phase)||emulator.state!=='running'||pendingSkip)return;
  releaseInputs();
  const v=new DataView(emulator.module.HEAPU8.buffer),sequence=(state.ack+1)&0xffff;
  v.setUint16(bridge+30,state.stage,true);
  v.setUint16(bridge+28,sequence,true);
  pendingSkip={stage:state.stage,sequence};$('skip').disabled=true;
  status(`正在判定第 ${state.stage} 关通过…`);$('canvas').focus();
});
function syncTestFlags(state){
  if(!baseline&&state&&[1,2,3].includes(state.phase)){
    const view=new DataView(emulator.module.HEAPU8.buffer),at=bridge+140;
    view.setUint16(at,(view.getUint16(at,true)&14)|(testInvincible?1:0),true);
  }
}
function updateSessionSettings(){
  if(!sessionSettings)return;
  $('session-settings').hidden=false;
  $('session-settings').textContent=`本次设置：${sessionSettings.players===3?'本地三人合作':sessionSettings.players===2?'本地双人合作':'单人多玉'} · ${$('rank').selectedOptions[0].textContent} · ${sessionSettings.count} 玉 · ${bossBalanceText(sessionSettings.players,sessionSettings.count)} · ${lifeCompensationText(sessionSettings.count,sessionSettings.lifeCompensation)} · 允许续关 · ${sessionSettings.debug?'调试开启':'调试关闭'}${testInvincible?' · 玩家无敌':''}`;
  $('debug-runtime').hidden=baseline||!sessionSettings.debug;
  $('runtime-invincible').checked=testInvincible;
  for(const id of ['test-p1-ghost','test-p2-ghost','rescue-test-note'])$(id).hidden=sessionSettings.players<2;
  $('test-p3-ghost').hidden=sessionSettings.players!==3;
}
function updateCoopHud(state){
  const feedback=coopFeedback(state,performance.now());
  const menu=state?.phase===0?state.coopMenu:0;
  $('continue-game').hidden=baseline||menu!==3;
  $('continue-game').disabled=!!state?.continueRequested;
  $('coop-menu-note').hidden=baseline||!menu;
  $('coop-menu-note').textContent=menu===1?'残机耗尽，正在进入续关流程…':menu===2?'成绩登记：按确认完成，随后选择续关。':menu===3?'可不限次数续关：点击“续关”或按确认，恢复初始残机（含补偿）和 Bomb；↑ / ↓ 可选择是否继续。':'';
  const shown=sessionSettings?.players>1&&!!state?.players;
  for(let i=0;i<3;i++){
    $(`test-p${i+1}-ghost`).disabled=!shown||state.phase!==2||!state.players[i]||state.players[i].ghost;
    $(`p${i+1}-hud`).hidden=$(`p${i+1}-marker`).hidden=!shown||!state.players[i];
  }
  $('coop-hud').hidden=!shown;
  $('coop-markers').hidden=!shown||![1,2].includes(state?.phase);
  if(!shown)return;
  const rect=$('canvas').getBoundingClientRect(),screen=$('screen').getBoundingClientRect();
  const width=Math.min(rect.width,rect.height*1.6),height=width/1.6;
  Object.assign($('coop-markers').style,{left:`${rect.left-screen.left+(rect.width-width)/2}px`,top:`${rect.top-screen.top+(rect.height-height)/2}px`,width:`${width}px`,height:`${height}px`});
  for(let i=0;i<state.players.length;i++){
    const player=state.players[i],name=`P${i+1}`;
    const protection=testInvincible?' · 测试无敌':player.invincibility>0?` · 受击/救援保护 ${(player.invincibility/56.4).toFixed(1)}s`:'';
    const event=feedback[i],notice=event?` · ${event.text}`:'';
    const text=`${name} · ${player.ghost?'幽灵：碰活着的队友即可复活':`残机 ${player.lives} · Bomb ${player.bombs}${protection}`}${notice} · 已获救 ${player.rescues}`;
    const hud=$(`p${i+1}-hud`);if(hud.textContent!==text)hud.textContent=text;hud.classList.toggle('hit-feedback',!!event?.hit);
    const marker=$(`p${i+1}-marker`);marker.textContent=name+(event?` ${event.text}`:player.ghost?' 👻':'');marker.classList.toggle('hit-feedback',!!event?.hit);
    marker.style.left=`${(player.left+16)/640*100}%`;marker.style.top='92%';
  }
}
$('continue-game').addEventListener('click',()=>{
  if(nativeState()?.coopMenu!==3||bridge<0)return;
  releaseInputs();new DataView(emulator.module.HEAPU8.buffer).setUint16(bridge+212,1,true);
  $('continue-game').disabled=true;$('canvas').focus();
});
function setInvincible(value){
  testInvincible=!baseline&&!!value;
  if(testInvincible&&sessionSettings)sessionSettings.debug=true;
  syncTestFlags(nativeState());updateSessionSettings();
}
if(new URLSearchParams(location.search).get('qa')==='1')installQA({emulator:()=>emulator,state:nativeState,bridge:()=>bridge,key,setInvincible,isInvincible:()=>testInvincible,baseline});
