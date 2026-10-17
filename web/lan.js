import {PROTOCOL,TICK_MS,PAUSE,RESUME,GameQueue,inputPolicy as makeInputPolicy,planReplay,nextInputs,PREDICTION_LEAD_LIMIT,ROLLBACK_ARM_AHEAD,MAX_ROLLBACK} from './netplay/protocol.js';
import {createFrameDisplay} from './frame-display.js';
import {LocalSfx} from './netplay/local-sfx.js';
import {createRelayChannel} from './netplay/relay-channel.js';
import {mountPlayer} from './player-ui.js';
import {LocalBgm} from './netplay/local-bgm.js';
import {loadRtcConfiguration} from './netplay/connection.js';
import {deploymentIceConfiguration} from './netplay/udp-config.js';
import {mergeDeparture} from './netplay/membership.js';
const GRACE_MS=5000;
const requestedNetwork=new URLSearchParams(location.search).get('network');
let network=['public-ws','direct-ws'].includes(requestedNetwork)?'public-ws':['public','public-rtc'].includes(requestedNetwork)?'public-rtc':requestedNetwork==='lan'?'lan':null;
let rtcPreparing=false,pendingSignals=[];
let bgm=null,committedPrefix=0,inflight=null,rollbackCount=0;
let sessionPolicy=null,runtimePolicy={ready:false,canPredict:false,blockReason:'游戏启动尚未完成'};
let replayUntil=0,inflightPlans=[],pendingKind='',resimulated=0,maxRewind=0,earlyInputs=0,inputAge=0;
let accumulator=0,lastNow=0,wakePending=false,wakeAt=0,wakeToken=0;
const rollbackPeers=new Set(),captureTimes=new Map(),wakeChannel=new MessageChannel();
wakeChannel.port1.onmessage=({data})=>{if(data!==wakeToken||!wakePending)return;wakePending=false;clearTimeout(timer);pump();};
const player=mountPlayer(document.getElementById('player'),{onGesture:ensureAudio,onChange:()=>queueMicrotask(()=>schedule(0))});
const screen=document.getElementById('screen');screen.classList.add('screen');player.stage.append(screen);
player.setLabel('当前玩家');
function touchContext(){
  const current=liveControl||lastState,p=current?.players?.[room?.slots[auth?.role]],menu=current?.paused??paused;
  const play=running&&!menu&&p&&!p.ghost&&!p.miss&&!p.entry;
  player.setActive(running);player.setContext({key:`${current?.generation||0}:${current?.players?.every(p=>p.ghost)?'menu':p?.ghost?'out':'play'}${menu?':menu':''}`,play:!!play});
}


const roles=['host','guest','guest2'],peers=new Map();
const offlineRoles=new Set(),hashHistory=new Map(),comparedFrames=new Map();
let membership=null,membershipId=0,lastDeparture=null,rtcConfiguration=null,relayRetry=0;
const activeRoles=()=>roles.slice(0,room?.settings.players||2);
const remoteRoles=()=>activeRoles().filter(role=>role!==auth?.role&&!offlineRoles.has(role));
let relay=null;
let pendingGo=false;
let earlyPackets=[];
const $=id=>document.getElementById(id),names=['灵梦','魔理沙','魅魔','幽香'];
let auth=null,room=null,version=null,pc=null,channel=null,worker=null,display=null,audio=null,context=null;
let queue=null,boot=null,peerHello=new Map(),peerLoaded=new Set(),loadedSent=false,running=false,paused=false,busy=false,connecting=false;
let timer=0,controls=0,pendingPresses=0,held=new Set(),touch=new Map(),pollTimer=0,pollBusy=false,epoch=0;
let pollFailures=0,pollFailedAt=0,pollRetryAt=0,pingSeq=0,nativeFps=null,lastDiagnosticAt=0;
const pings=new Map(),rtt=new Map();
let activity={phase:'idle',since:0,totals:{}};
let lastMessage=0,heartbeat=0,rtcTimeout=0,bootTimeout=0,sessionStarted=0;
let lastState=null,liveControl=null,hashes=new Map(),peerHashes=new Map(),hashMatches=0,waits=0,steps=0,endedReason=null;
let entering=false;
let bootProgress={};
let transport='rtc',fallbackPending=false,networkEvents=[];
const status=text=>{$('status').textContent=text;};
const overlay=text=>{$('overlay').hidden=!text;$('overlay').textContent=text||'';};
const keyBits={ArrowUp:1,KeyW:1,ArrowDown:2,KeyS:2,ArrowLeft:4,KeyA:4,ArrowRight:8,KeyD:8,KeyX:16,KeyL:16,KeyZ:32,KeyJ:32,ShiftLeft:64,ShiftRight:64,KeyK:64,Enter:256};
function buttons(){
  let live=0;for(const code of held)live|=keyBits[code]||0;for(const n of touch.values())live|=n;
  let value=live|pendingPresses;
  // Preserve taps between accepted frames. A current hold wins over an older
  // opposite tap, while simultaneous opposite holds cancel each other.
  for(const [a,b]of [[1,2],[4,8]])if((value&a)&&(value&b)){
    if(!!(live&a)!==!!(live&b))value&=~(live&a?b:a);else value&=~(a|b);
  }
  return value;
}
function clearInputs(){held.clear();touch.clear();pendingPresses=0;player.reset();}
function setActivity(phase){
  const now=performance.now();
  if(activity.since)activity.totals[activity.phase]=(activity.totals[activity.phase]||0)+now-activity.since;
  activity.phase=phase;activity.since=now;
}
function acceptState(value){
  if(lastState&&value.observedAt>lastState.observedAt){
    const delta=value.ticks-lastState.ticks;
    nativeFps=delta>=0?delta*1000/(value.observedAt-lastState.observedAt):null;
  }
  lastState=value;
}
function performanceInfo(){
  const now=performance.now(),totals={...activity.totals};
  if(running&&activity.since)totals[activity.phase]=(totals[activity.phase]||0)+now-activity.since;
  const elapsed=Object.values(totals).reduce((sum,n)=>sum+n,0)||1,costs=lastState?.costs||[];
  return {nativeGameFps:running&&performance.timeOrigin+now-(lastState?.observedAt||0)>2000?0:nativeFps,
    stepMeanMs:costs.length?costs.reduce((sum,n)=>sum+n,0)/costs.length:null,
    rttMs:Object.fromEntries(rtt),phase:activity.phase,
    timePercent:Object.fromEntries(Object.entries(totals).map(([key,n])=>[key,Math.round(n*1000/elapsed)/10])),
    pollFailures};
}
function diagnostics(){
  const now=performance.now();if(running&&now-lastDiagnosticAt<250)return;lastDiagnosticAt=now;
  const perf=performanceInfo(),latencies=Object.values(perf.rttMs),networkMs=latencies.length?Math.max(...latencies):null;
  const number=value=>value===null?'…':value.toFixed(1);
  const reason={'boot':'等待队友输入','window':'等待预测帧确认','prediction-disabled':'等待菜单输入确认','local-input':'等待本机输入',
    'prediction-lead':`等待队友输入（预测领先已达 ${PREDICTION_LEAD_LIMIT} 步）`,
    'network-wait':'等待队友输入',worker:'核心计算中',replay:'纠正迟到输入',restore:'恢复游戏状态',clock:'等待下一步',idle:'同步中'};
  $('net-performance').textContent=running?`${paused?'已暂停':`游戏 ${number(perf.nativeGameFps)} 帧/秒`} · 每步 ${number(perf.stepMeanMs)} ms · 往返 ${number(networkMs)} ms · 累计等输入 ${perf.timePercent['network-wait']||0}% · ${reason[queue?.waitReason||perf.phase]||'同步中'}`:'';
  $('diagnostics').textContent=JSON.stringify({protocol:PROTOCOL,seat:auth&&room?room.slots[auth.role]+1:null,
    frame:queue?.frame,confirmed:queue?.confirmed,hashMatches,paused,steps,waits,elapsedMs:sessionStarted?performance.now()-sessionStarted:0,
    rollbackEnabled:room?.settings.rollback,rollbackActive:queue?.active,activation:queue?.activation,inputPolicy:sessionPolicy,
    prediction:runtimePolicy,lead:queue?Math.max(0,queue.frame-queue.confirmed):0,predictionLeadLimit:PREDICTION_LEAD_LIMIT,maxRollback:MAX_ROLLBACK,
    waitReason:queue?.waitReason,rollbackCount,resimulated,maxRewind,earlyInputs,inputAgeMs:inputAge,
    startup:bootProgress,bootTimings:boot?.bootTimings,performance:perf,music:bgm?.status,connection:pc?.connectionState,channel:channel?.readyState,transport,networkEvents,recovery:recoveryInfo(),audio:audio?.info(),display:display?.metrics,state:lastState,endedReason},null,2);
  player.diagnostics($('diagnostics').textContent);
}
async function api(action,extra={},identity=auth){
  const payload={protocol:PROTOCOL,...(identity?{room:identity.room,token:identity.token,generation:identity.generation}:{}),...extra};
  const response=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'局域网服务请求失败');return data;
}
function render(){
  const lobby=auth&&room?.phase==='lobby',host=auth?.role==='host';
  const publicRoom=(room?.network||network)?.startsWith('public-');
  document.title=`怪绮谈 · ${publicRoom?'公网':'局域网'} 2–3 人`;
  $('page-title').textContent=publicRoom?'公网联机':'局域网联机';
  document.querySelector('.eyebrow').textContent=`TOUHOU 05 · ${publicRoom?'ONLINE':'LAN'}`;
  $('network-help').textContent=publicRoom?'全员打开同一个已部署的公网地址，无需处于同一 Wi-Fi。房主创建房间，队友输入房间号加入；全员准备后开始。':'全员连接同一个局域网，打开房主电脑的地址。房主创建房间，队友输入四位房间号加入；全员选择角色并准备后，由房主开始。';
  for(const link of document.querySelectorAll('[data-mode]')){
    if(link.dataset.mode===(publicRoom?'public':'lan'))link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  const relayMode=room?room.transport==='relay':network==='public-ws';
  $('connection-mode').textContent=publicRoom?(relayMode?'公网中继':'公网直连优先'):'局域网';
  $('connection-help').textContent=publicRoom?'所有人打开同一个公网网址。优先直连可减少服务器绕行；连不上时自动使用已部署的中继，也可在建房前指定始终使用中继。':'房主启动 start-lan.bat，所有设备打开房主终端显示的局域网地址。不要在队友设备输入 127.0.0.1。';
  $('public-transport-label').hidden=!publicRoom;$('public-transport').disabled=!!auth||entering;
  if(publicRoom)$('public-transport').value=room?.network||network;
  $('create').disabled=!!auth||!version||entering||(network==='public-ws'&&!version?.relayAvailable);$('join').disabled=!!auth||!version||entering;$('leave').disabled=!auth;
  $('lobby').hidden=!auth;$('pause').disabled=!running;
  if(!auth||!room)return;
  $('room-title').textContent=`房间 ${auth.room} · ${host?'我是房主':'我是队友'}`;
  $('my-seat').textContent=`我的角色：P${room.slots[auth.role]+1}`;
  for(const role of activeRoles()){
    const seat=$(role+'-seat');
    seat.textContent=`P${room.slots[role]+1} · ${role==='host'?'房主':'队友'} · ${offlineRoles.has(role)?'已离线（幽灵）':room.present[role]?names[room.characters[role]]+' · '+(room.ready[role]?'已准备':'未准备'):running?'连接中断':'等待加入'}`;
    seat.dataset.local=String(role===auth.role);seat.dataset.ready=String(!!room.ready[role]);seat.dataset.present=String(!!room.present[role]);
  }
  $('character').value=room.characters[auth.role];$('character').disabled=!lobby;
  $('seat').value=room.slots.host;$('seat').disabled=!lobby||!host;
  for(const key of ['rank','spares','bombs','language','rollback','players']){$(key).value=String(room.settings[key]);$(key).disabled=!lobby||!host;}
  $('ready').disabled=!lobby;$('ready').textContent=room.ready[auth.role]?'取消准备':'准备';
  $('guest2-seat').hidden=room.settings.players<3;
  $('seat').querySelector('[value="2"]').hidden=room.settings.players<3;
  $('start').disabled=!lobby||!host||!activeRoles().every(role=>room.present[role]&&room.ready[role]);
}
async function setRoom(data){
  if(!auth)return;
  if(data.state?.protocol!==PROTOCOL||data.state.generation!==auth.generation)throw Object.assign(Error('房间版本已失效，请重新建房。'),{fatal:true});
  if(room&&data.state.revision<room.revision)return;
  room=data.state;render();
  if(room.phase==='ended'){await finish('房间已结束，请重新建房。',false);return;}
  if(running)for(const role of remoteRoles())if(!room.present[role])suspect(role,'队友已离开');
  if(room.phase==='loading'&&!connecting){const identity=auth;connecting=true;connect().catch(error=>{if(auth===identity)finish(error.message);});}
  else if(room.phase==='loading'&&room.transport==='relay'&&transport!=='relay')switchRelay();
}
async function poll(){
  if(!auth||pollBusy||performance.now()<pollRetryAt)return;pollBusy=true;const identity=auth;
  try{
    const query=new URLSearchParams({room:identity.room,token:identity.token,generation:identity.generation});
    const response=await fetch('/api/events?'+query,{signal:AbortSignal.timeout(6000)}),data=await response.json();
    if(auth!==identity)return;
    if(!response.ok){const error=Error(data.error||'房间状态读取失败');error.fatal=response.status>=400&&response.status<500&&![408,429].includes(response.status);throw error;}
    if(pollFailures)status(running?'房间服务已恢复，游戏连接继续运行。':'房间服务已恢复，继续等待全员就绪。');
    pollFailures=0;pollFailedAt=pollRetryAt=0;
    await setRoom(data);for(const signal of data.messages||[])if(auth===identity)await receiveSignal(signal);
  }catch(error){
    if(auth===identity){
      const now=performance.now();pollFailedAt||=now;pollFailures++;
      pollRetryAt=now+Math.min(8000,500*2**Math.min(4,pollFailures));
      if(!running&&(error.fatal||(now-pollFailedAt>(connecting?600000:120000)&&channel?.readyState!=='open')))await finish(error.message,false);
      else status(channel?.readyState==='open'?'房间服务暂时不可用；游戏连接继续运行，正在重试。':'房间请求暂时失败，正在重试…');
    }
  }finally{pollBusy=false;}
}
async function enter(action){
  if(entering||auth)return;entering=true;render();
  try{
  const data=await api(action,action==='join'?{room:$('room-code').value.trim()}:{network});
  auth={room:data.room,token:data.token,role:data.role,generation:data.state.generation};
  room=data.state;endedReason=null;networkEvents=[];transport='rtc';fallbackPending=false;offlineRoles.clear();membership=null;membershipId=0;lastDeparture=null;render();status(`已${action==='create'?'创建':'加入'}房间 ${auth.room}。请选择角色并准备。`);
  pollFailures=0;pollFailedAt=pollRetryAt=0;
  pollTimer=setInterval(poll,500);
  }finally{entering=false;render();}
}
async function ensureAudio(){
  if(!context||context.state==='closed')context=new AudioContext({sampleRate:44100,latencyHint:'interactive'});
  await context.resume();
  if(!audio){audio=new LocalSfx(context);audio.ready=audio.load();}
  const prepared=audio;
  try{await prepared.ready;}catch(error){if(audio===prepared){prepared.disconnect();audio=null;}throw error;}
  if(audio!==prepared||prepared.closed)return;
  if(!bgm){bgm=new LocalBgm(context,()=>{});bgm.setVolume(Number($('bgm-volume').value)/100);const currentBgm=bgm;bgm.load({warmOpening:false}).catch(e=>{if(bgm===currentBgm)status('音乐加载失败：'+e.message);});}
  $('sound').textContent=context.state==='running'?'声音已开启':'开启声音';
}
function sendTo(role,message){
  if(!remoteRoles().includes(role))return false;
  const target=transport==='relay'?relay:peers.get(role)?.channel;
  if(target?.readyState!=='open'||target.bufferedAmount>65536){if(running)suspect(role,'等待连接恢复');return false;}
  try{target.send(JSON.stringify(transport==='relay'?{...message,to:role}:message));return true;}
  catch(error){networkFailure(error.message,{role});return false;}
}
function send(message){let sent=true;for(const role of remoteRoles())sent=sendTo(role,message)&&sent;return sent;}
function sendHandshake(role){if(!boot)return;sendTo(role,hello());if(loadedSent)sendTo(role,{type:'loaded'});}
function hello(){return {type:'hello',protocol:PROTOCOL,build:version.build,generation:auth.generation,slot:room.slots[auth.role],
  settings:room.settings,characters:room.characters,slots:room.slots,inputPolicy:makeInputPolicy(transport,room.settings.rollback),
  coreSha:boot.coreSha,diskSha:boot.diskSha,guestSha:boot.guestSha,checksum:boot.checksum};}
function tryLoaded(){
  if(!boot||loadedSent||channel?.readyState!=='open'||!remoteRoles().every(role=>peerHello.has(role)))return;
  const own=hello();
  for(const role of remoteRoles()){
    const remote=peerHello.get(role);
    for(const key of ['protocol','build','generation','settings','characters','slots','inputPolicy','coreSha','diskSha','guestSha','checksum'])
      if(JSON.stringify(own[key])!==JSON.stringify(remote[key]))throw Error('全员游戏版本、配置或初始状态不一致，请刷新后重新建房。');
    if(remote.slot!==room.slots[role]||remote.slot===own.slot)throw Error('玩家座位冲突');
  }
  loadedSent=true;send({type:'loaded'});tryGo();
}
function tryGo(){
  if(running||!loadedSent||!remoteRoles().every(role=>peerLoaded.has(role)))return;
  if(auth?.role==='host'){send({type:'go'});activate();}
  else if(pendingGo)activate();
}
function activate(){
  if(running||!boot||!loadedSent||!remoteRoles().every(role=>peerLoaded.has(role)))throw Error('全员尚未完成同步开局');
  clearTimeout(bootTimeout);running=true;connecting=true;paused=false;busy=false;
  sessionPolicy=makeInputPolicy(transport,room.settings.rollback);
  queue=new GameQueue(room.slots[auth.role],room.settings.rollback,room.settings.players,sessionPolicy);
  committedPrefix=0;inflight=null;rollbackCount=resimulated=maxRewind=earlyInputs=0;replayUntil=0;pendingKind='';inflightPlans=[];
  steps=waits=hashMatches=0;hashes.clear();peerHashes.clear();rollbackPeers.clear();captureTimes.clear();
  hashHistory.clear();comparedFrames.clear();for(const peer of peers.values()){peer.lastMessage=performance.now();peer.suspectAt=null;}
  activity={phase:'clock',since:performance.now(),totals:{}};nativeFps=null;
  for(const packet of earlyPackets)queue.receive(packet);earlyPackets=[];
  sessionStarted=lastNow=performance.now();accumulator=TICK_MS;capture();render();status('已连接。点击画面即可操作自己的角色。');
  $('canvas').focus();schedule();diagnostics();
}
function capture(){
  touchContext();
  const sampled=player.sample(buttons());
  if(sampled&128)controls|=128;
  const control=controls,packet=queue.capture(player.pack((sampled&~128)|control));
  if(packet){controls&=~control;pendingPresses=0;player.consume();captureTimes.set(packet.frame,performance.now());send(packet);return true;}
  return false;
}
function compare(frame){
  if(!hashes.has(frame)||!remoteRoles().every(role=>peerHashes.get(role)?.has(frame)))return;
  for(const role of remoteRoles())if(hashes.get(frame)!==peerHashes.get(role).get(frame))throw Error(`游戏状态在第 ${frame} 帧不同步，本局已停止。`);
  hashMatches++;hashes.delete(frame);for(const role of remoteRoles()){peerHashes.get(role)?.delete(frame);comparedFrames.set(role,Math.max(comparedFrames.get(role)||0,frame));}
}
function onPacket(event,source){try{
  if(typeof event.data!=='string'||event.data.length>4096)throw Error('连接消息超出限制');
  const message=JSON.parse(event.data);
  const role=source||message.from;if(offlineRoles.has(role))return;if(!remoteRoles().includes(role))throw Error('未知消息来源');
  if(transport==='relay'&&message.to&&message.to!==auth.role)return;
  lastMessage=performance.now();const peer=peers.get(role);
  if(peer){const recovering=peer.suspectAt!=null;peer.lastMessage=lastMessage;peer.suspectAt=null;if(recovering){status('连接已恢复，正在补齐输入并继续本局。');schedule(0);}}
  if(message.type==='hello'){
    if(peerHello.has(role))for(const key of Object.keys(peerHello.get(role)).filter(k=>!['from','to'].includes(k)))if(JSON.stringify(peerHello.get(role)[key])!==JSON.stringify(message[key]))throw Error('重连开局身份不一致');peerHello.set(role,message);tryLoaded();if(running)sendResume(role);
  }else if(message.type==='loaded'){
    if(!peerHello.has(role))throw Error('准备消息顺序异常');peerLoaded.add(role);tryGo();
  }else if(message.type==='go'){
    if(role!=='host'||auth.role==='host')throw Error('非法开局消息');pendingGo=true;tryGo();
  }else if(message.type==='resume'){
    acceptResume(role,message);
  }else if(message.type==='suspect'){
    if(auth.role!=='host'||!remoteRoles().includes(message.role)||message.role===role)throw Error('无效断线报告');if(!membership?.roles.includes(message.role))beginDeparture([message.role]);
  }else if(message.type==='departure-prepare'){
    if(role==='host'&&message.id===membership?.id&&JSON.stringify(message.roles)===JSON.stringify(membership.roles)){reportMembership();return;}
    if(role==='host'&&message.id<=membershipId&&Array.isArray(message.roles)&&message.roles.length&&message.roles.every(r=>offlineRoles.has(r)))return;
    if(role!=='host'||!running||!Number.isSafeInteger(message.id)||message.id<=membershipId||!Array.isArray(message.roles)||!message.roles.length||new Set(message.roles).size!==message.roles.length||message.roles.some(r=>r==='host'||!activeRoles().includes(r)))throw Error('无效离线协商');
    if(message.roles.includes(auth.role)){finish('连接恢复超时，你已与本局断开。',false);return;}
    membershipId=message.id;membership={id:message.id,roles:message.roles,started:performance.now(),reported:false};reportMembership();
  }else if(message.type==='departure-report'){
    if(auth.role!=='host')throw Error('离线报告只能发送给房主');
    if(membership&&message.id===membership.id&&!membership.roles.includes(role)){membership.reports.set(role,message.report);finishDeparture();}
  }else if(message.type==='departure-commit'){
    if(role!=='host')throw Error('只有房主能确认离线');applyDeparture(message);
  }else if(message.type==='input'){
    if(message.slot!==room.slots[role])throw Error('输入来源与座位不一致');
    if(!running){
      if(!connecting||!peerHello.has(role)||!Number.isSafeInteger(message.frame)||message.frame<0||message.frame>120||earlyPackets.length>=240)throw Error('开局前输入越界');
      earlyPackets.push(message);
    }else{queue.receive(message);schedule(0);}
  }else if(message.type==='rollback'){
    if(!running||role!=='host'||auth.role==='host')throw Error('无效回滚启用通知');
    queue.arm(message.frame);schedule(0);
  }else if(message.type==='input-tail'){
    if(!running||message.slot!==room.slots[role]||!Array.isArray(message.inputs)||message.inputs.length>160)throw Error('无效输入补包');
    for(const entry of message.inputs){
      if(!Array.isArray(entry)||entry.length!==2)throw Error('无效输入补包');
      queue.receive({slot:message.slot,frame:entry[0],buttons:entry[1]});
    }
    schedule(0);
  }else if(message.type==='hash'){
    if(!running||!Number.isSafeInteger(message.frame)||message.frame<0||message.frame>queue.frame+120||typeof message.hash!=='string'||!/^[0-9a-f]{8}$/.test(message.hash))throw Error('同步检查消息无效');
    if(typeof message.boot!=='boolean')throw Error('同步就绪信息无效');
    if(message.frame<=(comparedFrames.get(role)||0))return;
    if(!peerHashes.has(role))peerHashes.set(role,new Map());const lane=peerHashes.get(role);lane.set(message.frame,message.hash);if(lane.size>8)throw Error('同步检查积压');compare(message.frame);
    if(message.boot)rollbackPeers.add(role);armRollback();
  }else if(message.type==='ping'){
    if(!Number.isSafeInteger(message.id)||message.id<0)throw Error('无效延迟探测');
    sendTo(role,{type:'pong',id:message.id,to:role});
  }else if(message.type==='pong'){
    if(!Number.isSafeInteger(message.id)||!activeRoles().includes(message.to))throw Error('无效延迟应答');
    if(message.to===auth.role){
      const pending=pings.get(message.id);
      if(pending?.roles.delete(role))rtt.set(role,Math.round((performance.now()-pending.at)*10)/10);
      if(pending&&!pending.roles.size)pings.delete(message.id);
    }
  }else if(message.type==='stop'){
    if(role==='host'||!running)finish(typeof message.reason==='string'?`房主结束本局：${message.reason.slice(0,250)}`:'房主已离开，本局结束。',false);
    else{suspect(role,'队友已离开');if(auth.role==='host')beginDeparture([role]);}
  }else throw Error('未知连接消息');
}catch(error){finish(error.message);}}
function recoveryInfo(){return {graceMs:GRACE_MS,offline:[...offlineRoles],membership:membership?{id:membership.id,roles:membership.roles}:null,
  peers:Object.fromEntries([...peers].map(([role,p])=>[role,{suspect:p.suspectAt!=null,attempt:p.attempt||0,channel:p.channel?.readyState,lastMessageAgoMs:Math.round(performance.now()-p.lastMessage)}]))};}
function suspect(role,reason){
  if(!running||offlineRoles.has(role))return;
  const peer=peers.get(role);if(!peer)return;
  if(peer.suspectAt==null){peer.suspectAt=performance.now();status(`P${room.slots[role]+1} 连接中断，等待恢复（5 秒）…`);networkEvents.push({message:reason,role,transport,atMs:Math.round(performance.now())});if(networkEvents.length>10)networkEvents.shift();}
}
function resumePacket(){return {type:'resume',hello:hello(),frame:queue.frame,activation:queue.activation,
  inputs:[...queue.inputs[queue.slot]].filter(([at])=>at>=queue.frame-32),hashes:[...hashHistory.values()]};}
function sendResume(role){if(!running)return;sendTo(role,resumePacket());const change=membership||lastDeparture;if(change){sendTo(role,{type:'departure-prepare',id:change.id,roles:change.roles});if(!membership)sendTo(role,lastDeparture);}}
function acceptResume(role,message){
  const remote=message.hello,own=hello();
  if(!remote||remote.slot!==room.slots[role])throw Error('重连身份无效');
  for(const key of ['protocol','build','generation','settings','characters','slots','inputPolicy','coreSha','diskSha','guestSha','checksum'])if(JSON.stringify(remote[key])!==JSON.stringify(own[key]))throw Error('重连游戏版本或开局身份不一致');
  if(!running){peerHello.set(role,{...remote,...(transport==='relay'?{to:auth.role}:{} )});peerLoaded.add(role);if(role==='host')pendingGo=true;tryLoaded();tryGo();}
  if(!running)return;
  if(!Number.isSafeInteger(message.frame)||Math.abs(message.frame-queue.frame)>120||!Array.isArray(message.inputs)||message.inputs.length>160||!Array.isArray(message.hashes)||message.hashes.length>8)throw Error('重连状态越界');
  for(const entry of message.inputs){if(!Array.isArray(entry)||entry.length!==2)throw Error('重连输入无效');queue.receive({slot:remote.slot,frame:entry[0],buttons:entry[1]});}
  if(role==='host'&&message.activation!==null){if(queue.activation===null)queue.arm(message.activation);else if(queue.activation!==message.activation)throw Error('重连回滚边界不一致');}
  for(const hash of message.hashes)onPacket({data:JSON.stringify(hash)},role);
  schedule(0);
}
function reportMembership(){
  if(!membership||busy||(membership.reported&&auth.role==='host'))return;
  membership.reported=true;const report=queue.membershipReport();
  if(auth.role==='host'){membership.reports.set('host',report);finishDeparture();}
  else sendTo('host',{type:'departure-report',id:membership.id,report});
}
function beginDeparture(dropped){
  if(!running||auth?.role!=='host')return;
  const targets=[...new Set([...(membership?.roles||[]),...dropped])].filter(r=>!offlineRoles.has(r));
  if(!targets.length)return;
  if(targets.some(r=>r==='host'||!remoteRoles().includes(r)))throw Error('无效离线目标');
  membership={id:++membershipId,roles:targets,reports:new Map(),started:performance.now(),reported:false};
  send({type:'departure-prepare',id:membership.id,roles:targets});reportMembership();
}
function finishDeparture(){
  if(auth?.role!=='host'||!membership||busy||!membership.reports.has('host'))return;
  const remaining=remoteRoles().filter(r=>!membership.roles.includes(r));
  if(!remaining.every(r=>membership.reports.has(r)))return;
  const change=mergeDeparture([...membership.reports.values()],membership.roles.map(r=>room.slots[r]),room.settings.players);
  const message={type:'departure-commit',id:membership.id,roles:membership.roles,...change};
  for(const role of remaining)if(!sendTo(role,message))return;
  const dropped=membership.roles.slice(),identity=auth;applyDeparture(message);
  api('drop',{roles:dropped},identity).then(data=>{if(auth===identity)setRoom(data);}).catch(()=>{});
}
function applyDeparture(message){
  if(message.id<=membershipId&&message.roles?.every(r=>offlineRoles.has(r)))return;
  if(!membership||message.id!==membership.id||JSON.stringify(message.roles)!==JSON.stringify(membership.roles)||JSON.stringify(message.slots)!==JSON.stringify(message.roles.map(r=>room.slots[r])))throw Error('离线确认不匹配');
  queue.applyDeparture(message);
  for(const role of message.roles){offlineRoles.add(role);const peer=peers.get(role);if(peer){peer.suspectAt=null;clearTimeout(peer.repairTimer);if(peer.channel){peer.channel.onopen=peer.channel.onclose=peer.channel.onerror=peer.channel.onmessage=null;peer.channel.close();}peer.pc?.close();}peerHashes.delete(role);rollbackPeers.delete(role);}
  lastDeparture=message;membership=null;lastNow=performance.now();accumulator=0;clearInputs();
  for(const at of [...hashes.keys()])compare(at);
  render();status('离线队友已转为幽灵，其余玩家继续本局。');schedule(0);
}
function startHeartbeat(){
  clearInterval(heartbeat);heartbeat=setInterval(()=>{try{
    const now=performance.now();
    for(const role of remoteRoles()){
      const peer=peers.get(role);if(!peer)continue;
      if(running&&now-peer.lastMessage>3000)suspect(role,'队友暂时无响应');
      if(running&&transport==='rtc'&&peer.suspectAt!=null)repairPeer(role);
      if(running&&peer.suspectAt!=null&&now-peer.suspectAt>=GRACE_MS){
        if(role==='host'){finish('房主连接恢复超时，本局结束。',false);return;}
        if(!membership?.roles.includes(role)){if(auth.role==='host')beginDeparture([role]);else sendTo('host',{type:'suspect',role});}
      }
    }
    const id=++pingSeq;pings.set(id,{at:now,roles:new Set(remoteRoles())});
    for(const [key,value]of pings)if(now-value.at>15000)pings.delete(key);
    send({type:'ping',id});
    if(running)send({type:'input-tail',slot:queue.slot,inputs:[...queue.inputs[queue.slot]].filter(([at])=>at>=queue.frame-32)});
    if(running&&membership){reportMembership();if(auth.role==='host'&&now-membership.started>=GRACE_MS){const missing=remoteRoles().filter(r=>!membership.roles.includes(r)&&!membership.reports.has(r));if(missing.length)beginDeparture(missing);else finishDeparture();}else if(auth.role!=='host'&&now-membership.started>=15000)finish('房主未完成离线同步。',false);}
    if(running)diagnostics();
  }catch(error){finish(error.message);}},1000);
}
function meshChannel(){
  return {ordered:true,maxRetransmits:null,maxPacketLifeTime:null,
    get readyState(){return remoteRoles().every(role=>peers.get(role)?.channel?.readyState==='open')?'open':'connecting';},
    get bufferedAmount(){return Math.max(0,...remoteRoles().map(role=>peers.get(role)?.channel?.bufferedAmount||0));},
    send(data){for(const role of remoteRoles()){const c=peers.get(role)?.channel;if(c?.readyState!=='open')throw Error('游戏连接已断开');c.send(data);}},
    close(){for(const peer of peers.values())peer.channel?.close();}};
}
function attachChannel(value,role){
  const peer=peers.get(role);
  if(!peer||peer.channel)throw Error('重复游戏连接');peer.channel=value;
  if(!value.ordered||value.maxRetransmits!==null||value.maxPacketLifeTime!==null)throw Error('游戏需要可靠有序连接');
  value.onmessage=event=>{if(peers.get(role)===peer)onPacket(event,role);};
  value.onclose=()=>{if(peers.get(role)===peer&&auth&&!offlineRoles.has(role))networkFailure('连接已关闭',{role});};
  value.onerror=event=>{if(peers.get(role)===peer)networkFailure(event.error?.message||'游戏数据通道发生错误',{role});};
  value.onopen=()=>{
    if(peers.get(role)!==peer||!auth)return;
    if(room?.transport==='relay'){switchRelay();return;}
    try{peer.repairing=false;if(running)sendResume(role);else sendHandshake(role);if(channel.readyState==='open'){clearTimeout(rtcTimeout);startHeartbeat();tryLoaded();}}catch(error){networkFailure(error.message,{role});}
  };
}
function closeTransport(){
  clearInterval(heartbeat);clearTimeout(rtcTimeout);clearTimeout(relayRetry);relayRetry=0;
  if(relay){relay.onopen=relay.onclose=relay.onerror=relay.onmessage=null;relay.close();relay=null;}
  const previous=[...peers.values()];peers.clear();
  for(const peer of previous){clearTimeout(peer.repairTimer);const c=peer.channel;if(c){c.onopen=c.onclose=c.onerror=c.onmessage=null;c.close();}if(peer.pc){peer.pc.onconnectionstatechange=peer.pc.ondatachannel=null;peer.pc.close();}}
  channel=null;pc=null;
}
function networkFailure(message,detail={}){
  networkEvents.push({message,...detail,transport,rollbackEnabled:room?.settings.rollback,rollbackCount,music:bgm?.status,connection:pc?.connectionState,ice:pc?.iceConnectionState,channel:channel?.readyState,atMs:Math.round(performance.now())});
  if(networkEvents.length>10)networkEvents.shift();diagnostics();
  if(!running&&transport==='rtc'){requestRelay(message);return;}
  if(!running){status('中继连接暂时中断，正在重试…');retryRelay();return;}
  for(const role of detail.role?[detail.role]:remoteRoles()){suspect(role,message);if(transport==='rtc')repairPeer(role);}
  if(transport==='relay'&&relay?.readyState!=='open')retryRelay();
}
async function requestRelay(reason){
  if(!auth||fallbackPending||transport==='relay')return;
  fallbackPending=true;const identity=auth;
  if(networkEvents.at(-1)?.message!==reason)networkEvents.push({message:reason,transport:'rtc',rollbackEnabled:room?.settings.rollback,rollbackCount,music:bgm?.status,connection:pc?.connectionState,ice:pc?.iceConnectionState,atMs:Math.round(performance.now())});
  status('直连未成功，正在自动切换中继连接…');
  try{
    const data=await api('fallback',{},identity);if(auth===identity)await setRoom(data);
  }catch(error){if(auth===identity)finish(`${reason}；${error.message}`,false);}
  finally{if(auth===identity)fallbackPending=false;}
}
function switchRelay(){
  if(transport==='relay'||!auth)return;
  if(running){finish('队友连接中断，本局结束，请重新建房。');return;}
  closeTransport();transport='relay';peerHello.clear();peerLoaded.clear();loadedSent=false;pendingGo=false;earlyPackets=[];
  for(const role of remoteRoles())peers.set(role,{role,pc:null,channel:null,lastMessage:performance.now(),suspectAt:null});
  openRelay();
}
function retryRelay(){
  if(!auth||transport!=='relay'||relayRetry)return;
  const identity=auth;relayRetry=setTimeout(()=>{relayRetry=0;if(auth===identity&&transport==='relay')openRelay();},300);
}
function openRelay(){
  if(!auth||transport!=='relay')return;
  if(relay){relay.onopen=relay.onclose=relay.onerror=relay.onmessage=relay.onpeerchange=null;relay.close();}
  relay=createRelayChannel(auth);channel=relay;
  const currentRelay=relay,identity=auth;
  relay.onmessage=event=>{if(relay===currentRelay)onPacket(event);};
  relay.onpeerchange=({role,connected})=>{if(relay!==currentRelay||!remoteRoles().includes(role))return;if(connected){if(running)sendResume(role);else sendHandshake(role);}else suspect(role,'中继队友连接中断');};
  relay.onclose=()=>{if(relay===currentRelay&&auth)networkFailure('中继连接已关闭');};
  relay.onerror=event=>{if(relay===currentRelay)networkFailure(event.error?.message||'中继连接错误');};
  relay.onopen=()=>{if(auth!==identity||relay!==currentRelay)return;try{clearTimeout(rtcTimeout);for(const role of remoteRoles()){if(running)sendResume(role);else sendHandshake(role);}startHeartbeat();}catch(error){networkFailure(error.message);}};
  if(!running)status('正在通过服务建立联机连接…');
  clearTimeout(rtcTimeout);rtcTimeout=setTimeout(()=>{if(auth===identity)networkFailure('联机中继连接超时');},15000);diagnostics();
}
async function completeIce(connection){
  if(connection.iceGatheringState==='complete')return;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{connection.removeEventListener('icegatheringstatechange',changed);reject(Error('局域网连接地址收集超时'));},10000);
    function changed(){if(connection.iceGatheringState==='complete'){clearTimeout(timeout);connection.removeEventListener('icegatheringstatechange',changed);resolve();}}
    connection.addEventListener('icegatheringstatechange',changed);
  });
}
async function connect(){
  const current=++epoch,identity=auth;status('正在连接队友并启动游戏…');
  bootProgress={};
  let directRelay=room.transport==='relay';rtcConfiguration=null;
  rtcPreparing=!directRelay;
  if(!directRelay){
    const source=globalThis.th05NetplayUdp??globalThis.th05NetplayConnection??(room.network==='public-rtc'?deploymentIceConfiguration:undefined);
    rtcConfiguration=await loadRtcConfiguration(identity,source);
    if(current!==epoch||auth!==identity)return;
    directRelay=room.transport==='relay';
  }
  if((directRelay?!globalThis.WebSocket:!globalThis.RTCPeerConnection)||!globalThis.Worker||!globalThis.OffscreenCanvas||!globalThis.DecompressionStream)throw Error('此浏览器缺少联机运行能力，请使用新版 Edge / Chrome。');
  if(transport!=='relay')channel=meshChannel();
  for(const role of directRelay?[]:remoteRoles())makePeer(role);
  rtcPreparing=false;
  for(const signal of pendingSignals.splice(0))void receiveSignal(signal).catch(error=>{if(auth===identity)finish(error.message);});
  if(!directRelay)rtcTimeout=setTimeout(()=>{if(auth===identity&&transport==='rtc')requestRelay('WebRTC 连接超时');},room.network==='public-rtc'?20000:8000);
  bootTimeout=setTimeout(()=>finish('全员启动或同步确认超时，请重新建房。'),600000);
  display=createFrameDisplay($('canvas'),{release:seq=>worker?.postMessage({type:'frame-ack',seq}),onError:error=>finish(error.message)});
  worker=new Worker('lan-worker.js',{type:'module'});
  worker.onerror=event=>{if(current===epoch)finish(event.message||'游戏 Worker 启动失败');};
  worker.onmessage=({data})=>{
    if(current!==epoch){data.bitmap?.close();return;}
    try{
      if(data.control){liveControl=data.control;touchContext();}
      if(data.type==='boot-progress'){
        bootProgress[data.stage]=data.message;
        if(!running)status(data.message);diagnostics();
      }else if(data.type==='session-exit'){finish('已从游戏暂停菜单退出，本局结束。');return;}
      else if(data.type==='frame')display.receive(data);
      else if(data.type==='sfx')audio?.push(data.events);
      else if(data.type==='music'){for(const [ax,hash]of data.events)bgm?.command(ax,hash);}
      else if(data.type==='hash'){hashes.set(data.frame,data.hash);if(hashes.size>8)throw Error('同步检查积压');const packet={type:'hash',frame:data.frame,hash:data.hash,boot:data.boot};hashHistory.set(data.frame,packet);while(hashHistory.size>8)hashHistory.delete(hashHistory.keys().next().value);send(packet);compare(data.frame);armRollback();}
      else if(data.type==='pause-state'){
        paused=data.paused;clearInputs();audio?.flush();
        overlay('');$('pause').textContent=paused?'继续游戏':'暂停游戏';
        status(paused?'游戏暂停菜单：方向键选择，Z / Enter 确认，Esc 继续；选择退出会结束本局。':'游戏继续。');touchContext();
      }else if(data.type==='restored'){
        if(!busy||pendingKind!=='restore'||data.frame!==queue.frame)throw Error('回滚恢复边界异常');
        busy=false;setActivity('idle');pendingKind='';runtimePolicy=data.policy;confirmFrames();schedule(0);
      }else if(data.type==='replayed'){
        if(!busy||pendingKind!=='replay'||!Number.isInteger(data.applied)||data.applied<0||data.applied>inflightPlans.length||data.frame!==queue.frame+data.applied)throw Error('回滚返回边界异常');
        for(const plan of inflightPlans.slice(0,data.applied))queue.commit(plan.pair);
        resimulated+=data.applied;busy=false;setActivity('idle');pendingKind='';inflightPlans=[];runtimePolicy=data.policy;
        if(data.state)acceptState(data.state);confirmFrames();schedule(data.applied||queue.dirty!==null?0:16);diagnostics();
      }
      else if(data.type==='ready'){
        boot=data;liveControl=data.state;acceptState(data.state);runtimePolicy=data.state.syncPolicy;status('游戏已就绪，等待队友完成同步…');diagnostics();
        if(transport==='relay'){if(channel?.readyState==='open')send(hello());}else for(const peer of peers.values())if(peer.channel?.readyState==='open')peer.channel.send(JSON.stringify(hello()));tryLoaded();
      }else if(data.type==='stepped'){
        if(!busy||pendingKind!=='step'||data.frame!==queue.frame+1)throw Error('核心返回了错误同步帧');
        const capturedAt=captureTimes.get(queue.frame);if(capturedAt)inputAge=performance.now()-capturedAt;captureTimes.delete(queue.frame);
        busy=false;setActivity('idle');queue.commit(inflight);inflight=null;steps++;
        pendingKind='';runtimePolicy=data.policy;if(data.state)acceptState(data.state);
        confirmFrames();schedule();if(steps%30===0)diagnostics();
      }else if(data.type==='error')throw Error(data.message);
      if(membership)reportMembership();
    }catch(error){finish(error.message);}
  };
  const config={rank:room.settings.rank,players:[]};
  for(const role of activeRoles())config.players[room.slots[role]]={character:room.characters[role],spares:room.settings.spares,bombs:room.settings.bombs};
  worker.postMessage({type:'boot',settings:room.settings,config,viewSlot:room.slots[auth.role]});
if(room?.transport==='relay'){switchRelay();return;}
  await Promise.all(remoteRoles().filter(role=>roles.indexOf(identity.role)<roles.indexOf(role)).map(role=>offerPeer(peers.get(role))));
}
function makePeer(role,attempt=0){
  const old=peers.get(role),identity=auth,connection=new RTCPeerConnection(rtcConfiguration);
  if(old){clearTimeout(old.repairTimer);if(old.channel){old.channel.onopen=old.channel.onclose=old.channel.onerror=old.channel.onmessage=null;old.channel.close();}if(old.pc){old.pc.onconnectionstatechange=old.pc.ondatachannel=null;old.pc.close();}}
  const peer={role,pc:connection,channel:null,lastMessage:old?.lastMessage||performance.now(),suspectAt:old?.suspectAt??null,signalChain:Promise.resolve(),attempt,repairing:attempt>0,attemptAt:performance.now(),repairTimer:0};peers.set(role,peer);
  if(!pc||pc===old?.pc)pc=connection;
  connection.ondatachannel=event=>{if(auth!==identity||peers.get(role)!==peer){event.channel.close();return;}try{
    if(roles.indexOf(identity.role)<roles.indexOf(role))throw Error('意外的数据通道');attachChannel(event.channel,role);
  }catch(error){finish(error.message);}};
  connection.onconnectionstatechange=()=>{if(auth!==identity||peers.get(role)!==peer||offlineRoles.has(role))return;
    if(connection.connectionState==='failed'||running&&['disconnected','closed'].includes(connection.connectionState))networkFailure('WebRTC 连接中断',{role});};
  return peer;
}
async function offerPeer(peer){
  if(!peer||transport!=='rtc'||!auth)return;
  const identity=auth,{role,pc:connection}=peer;
  try{
    attachChannel(connection.createDataChannel('th05-input',{ordered:true}),role);
    await connection.setLocalDescription(await connection.createOffer());await completeIce(connection);
    if(auth!==identity||peers.get(role)!==peer||transport!=='rtc'||offlineRoles.has(role))return;
    await api('signal',{to:role,signal:{...connection.localDescription.toJSON(),attempt:peer.attempt}},identity);
  }catch(error){if(auth===identity&&peers.get(role)===peer&&transport==='rtc')networkFailure(error.message,{role});}
}
function startPeerRepair(role){
  const peer=peers.get(role);if(!peer||!running||transport!=='rtc'||offlineRoles.has(role)||membership?.roles.includes(role))return;
  if(peer.repairing&&performance.now()-peer.attemptAt<2500)return;
  void offerPeer(makePeer(role,peer.attempt+1));
}
function repairPeer(role){
  const peer=peers.get(role);if(!peer||!running||transport!=='rtc'||offlineRoles.has(role)||peer.repairTimer||membership?.roles.includes(role))return;
  if(peer.channel?.readyState==='open'&&peer.pc.connectionState==='connected')return;
  const identity=auth;peer.repairTimer=setTimeout(()=>{peer.repairTimer=0;if(auth!==identity||peers.get(role)!==peer||offlineRoles.has(role))return;
    if(roles.indexOf(identity.role)<roles.indexOf(role))startPeerRepair(role);
    else api('signal',{to:role,signal:{type:'repair'}},identity).catch(()=>{});
  },200);
}
async function receiveSignal(envelope){
  if(!auth||room?.transport==='relay'||transport==='relay')return;
  if(rtcPreparing){if(pendingSignals.length>=16)throw Error('等待连接配置时收到过多信令');pendingSignals.push(envelope);return;}
  const role=envelope.from,signal=envelope.signal,identity=auth;let peer=peers.get(role);
  if(offlineRoles.has(role))return;
  if(!peer||!signal)throw Error('未知信令来源');
  if(signal.type==='repair'){if(roles.indexOf(identity.role)>=roles.indexOf(role))throw Error('重连请求身份无效');startPeerRepair(role);return;}
  const attempt=signal.attempt||0;
  if(!Number.isSafeInteger(attempt)||attempt<0)throw Error('重连序号无效');
  if(attempt<peer.attempt)return;
  if(attempt>peer.attempt){if(signal.type!=='offer'||roles.indexOf(identity.role)<roles.indexOf(role))throw Error('重连协商身份无效');peer=makePeer(role,attempt);}
  peer.signalChain=peer.signalChain.then(async()=>{
    if(auth!==identity||peers.get(role)!==peer||transport!=='rtc')return;
    const connection=peer.pc,offerer=roles.indexOf(identity.role)<roles.indexOf(role);
    if(connection.remoteDescription){if(connection.remoteDescription.sdp===signal.sdp)return;throw Error('重复连接描述');}
    if(signal.type==='offer'&&!offerer){
      await connection.setRemoteDescription(signal);await connection.setLocalDescription(await connection.createAnswer());await completeIce(connection);
      if(auth===identity&&peers.get(role)===peer&&transport==='rtc')await api('signal',{to:role,signal:{...connection.localDescription.toJSON(),attempt:peer.attempt}},identity);
    }else if(signal.type==='answer'&&offerer)await connection.setRemoteDescription(signal);
    else throw Error('连接消息与身份不一致');
  }).catch(error=>{if(auth===identity&&peers.get(role)===peer&&transport==='rtc')networkFailure(error.message,{role});});
  // The chain preserves each peer's SDP order. ICE gathering must not hold up
  // room polling or another peer's negotiation (especially in a three-seat room).
}
function schedule(delay){
  if(!running||busy)return;
  const now=performance.now();
  if(delay===undefined)delay=queue.dirty!==null||queue.frame<replayUntil?0:Math.max(0,TICK_MS-accumulator-(now-lastNow));
  const deadline=now+delay;if(wakePending&&wakeAt<=deadline)return;
  clearTimeout(timer);wakeAt=deadline;wakePending=true;const token=++wakeToken;
  // Match TH04's immediate MessageChannel wake for replay and fresh inputs.
  if(delay===0)wakeChannel.port2.postMessage(token);
  else timer=setTimeout(()=>{if(token!==wakeToken||!wakePending)return;wakePending=false;pump();},delay);
}
function armRollback(){
  if(!running||membership||auth.role!=='host'||!sessionPolicy.rollbackEnabled||queue.activation!==null||!runtimePolicy.ready||!remoteRoles().every(role=>rollbackPeers.has(role)))return;
  const frame=queue.frame+ROLLBACK_ARM_AHEAD;queue.arm(frame);send({type:'rollback',frame});
}
function confirmFrames(){
  if(membership||queue.dirty!==null)return;
  const prefix=Math.min(queue.confirmed,queue.frame);
  if(prefix>committedPrefix){worker.postMessage({type:'confirm',prefix});committedPrefix=prefix;queue.prune();}
  armRollback();
}
function pump(){try{
  if(!running||busy)return;
  if(membership){reportMembership();return;}
  if(channel.bufferedAmount>65536){for(const role of remoteRoles())suspect(role,'网络发送暂时积压');setActivity('network-wait');schedule(16);return;}
  const now=performance.now();accumulator=Math.min(accumulator+Math.max(0,now-lastNow),TICK_MS*4);lastNow=now;
  if(queue.dirty!==null){
    // Publish due live input before costly restore, never from a history frame.
    if(queue.frame>=replayUntil&&accumulator>=TICK_MS&&capture())earlyInputs++;
    const at=queue.dirty;replayUntil=Math.max(replayUntil,queue.frame);
    maxRewind=Math.max(maxRewind,replayUntil-at);rollbackCount++;queue.rewind(at);
    busy=true;setActivity('restore');pendingKind='restore';worker.postMessage({type:'restore',frame:at});return;
  }
  confirmFrames();
  if(queue.frame<replayUntil){
    inflightPlans=planReplay(queue,replayUntil,runtimePolicy.canPredict);
    if(!inflightPlans.length){waits++;nextInputs(queue,runtimePolicy.canPredict);setActivity('network-wait');schedule(16);return;}
    busy=true;setActivity('replay');pendingKind='replay';worker.postMessage({type:'replay-slice',frame:queue.frame,plans:inflightPlans});return;
  }
  if(accumulator<TICK_MS){setActivity('clock');schedule();return;}
  // Capture/broadcast the due local input before pacing, so a waiting peer
  // still receives what it needs to advance its confirmed prefix.
  capture();const pair=nextInputs(queue,runtimePolicy.canPredict);
  if(!pair){waits++;setActivity('network-wait');schedule(16);return;}
  accumulator-=TICK_MS;busy=true;setActivity('worker');pendingKind='step';inflight=pair;
  worker.postMessage({type:'step',frame:queue.frame,pair,predicted:queue.active&&queue.frame>=queue.confirmed,offlineMask:queue.offlineMask()});
}catch(error){finish(error.message);}}
function pauseControl(){if(!running)return;clearInputs();controls|=paused?RESUME:PAUSE;$('canvas').focus();schedule(0);}
async function finish(reason,notify=true){
  if(!auth&&!worker)return;const identity=auth;
  if(notify&&channel?.readyState==='open')try{send({type:'stop',reason:reason.slice(0,250)});}catch{}
  auth=null;epoch++;running=connecting=busy=paused=false;rtcPreparing=false;pendingSignals=[];liveControl=null;controls=0;clearInputs();
  setActivity('ended');pings.clear();rtt.clear();nativeFps=null;
  clearInterval(pollTimer);clearInterval(heartbeat);clearTimeout(timer);clearTimeout(rtcTimeout);clearTimeout(bootTimeout);
  wakePending=false;wakeToken++;sessionPolicy=null;runtimePolicy={ready:false,canPredict:false,blockReason:'游戏已结束'};
  worker?.terminate();worker=null;display?.stop();display=null;audio?.disconnect();audio=null;
  bgm?.dispose();bgm=null;context?.close().catch(()=>{});context=null;player.setActive(false);player.exit();
  closeTransport();fallbackPending=false;
  offlineRoles.clear();membership=null;membershipId=0;lastDeparture=null;hashHistory.clear();comparedFrames.clear();
  boot=null;peerHello.clear();peerLoaded.clear();loadedSent=pendingGo=false;earlyPackets=[];queue=null;room=null;
  endedReason=reason;status(reason);overlay(reason);render();diagnostics();
  if(identity)try{await api('leave',{},identity);}catch{}
}
function action(fn){return async()=>{try{await fn();}catch(error){status(error.message);}};}
let lobbyChanges=Promise.resolve();
function change(action,extra={}){
  const identity=auth;
  const request=lobbyChanges.catch(()=>{}).then(async()=>{
    if(auth!==identity)return;
    // Preserve each selected value while prior requests/polls redraw the UI.
    // Merge one changed setting only after the previous response is applied.
    const payload=action==='settings'?{...room.settings,...extra}:extra;
    const data=await api(action,payload,identity);if(auth===identity)await setRoom(data);
  });
  lobbyChanges=request;return request;
}
$('create').onclick=action(()=>enter('create'));$('join').onclick=action(()=>enter('join'));
$('leave').onclick=()=>finish('已离开房间，可重新建房。');
$('character').onchange=action(()=>change('character',{character:Number($('character').value)}));
$('seat').onchange=action(()=>change('seat',{seat:Number($('seat').value)}));
for(const key of ['rank','spares','bombs','language','rollback','players'])$(key).onchange=action(()=>change('settings',{
  [key]:key==='language'?$(key).value:key==='rollback'?$(key).value==='true':Number($(key).value)}));
$('ready').onclick=action(async()=>{const identity=auth;await ensureAudio();if(auth===identity)await change('ready',{ready:!room.ready[auth.role]});});
$('start').onclick=action(async()=>{const identity=auth;await ensureAudio();if(auth===identity)await change('start');});
$('pause').onclick=pauseControl;$('sound').onclick=action(ensureAudio);
$('fullscreen').onclick=action(()=>player.enter());
$('bgm-volume').oninput=()=>bgm?.setVolume(Number($('bgm-volume').value)/100);
$('capture').onclick=action(async()=>{const blob=await new Promise(resolve=>$('canvas').toBlob(resolve,'image/png'));if(!blob)throw Error('画面保存失败');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='th05-lan.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
for(const type of ['keydown','keyup'])addEventListener(type,event=>{
  if(!running||/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName))return;
  if(event.code==='Escape'){event.preventDefault();if(type==='keydown'&&!event.repeat)pauseControl();return;}
  if(!keyBits[event.code])return;event.preventDefault();
  if(type==='keydown'){if(!held.has(event.code))pendingPresses|=keyBits[event.code];held.add(event.code);}else held.delete(event.code);
  schedule(0);
});
for(const button of document.querySelectorAll('[data-input]')){
  button.onpointerdown=event=>{if(!running)return;event.preventDefault();button.setPointerCapture(event.pointerId);const bits=Number(button.dataset.input);touch.set(event.pointerId,bits);pendingPresses|=bits;schedule(0);};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,event=>touch.delete(event.pointerId));
}
addEventListener('blur',()=>{clearInputs();if(running&&!paused){controls|=PAUSE;schedule(0);}});
document.addEventListener('visibilitychange',()=>{clearInputs();if(document.hidden&&running&&!paused){controls|=PAUSE;schedule(0);}});
addEventListener('pagehide',()=>{if(!auth)return;const data=JSON.stringify({...auth,protocol:PROTOCOL});navigator.sendBeacon('/api/leave',new Blob([data],{type:'application/json'}));});
// Read-only diagnostics for repeatable two-browser validation.
globalThis.th05Lan={get info(){return {running,paused,rollbackEnabled:room?.settings.rollback,rollbackActive:queue?.active,activation:queue?.activation,inputPolicy:sessionPolicy,prediction:runtimePolicy,
  performance:performanceInfo(),recovery:recoveryInfo(),
  replayUntil,resimulated,maxRewind,earlyInputs,inputAgeMs:inputAge,lead:queue?Math.max(0,queue.frame-queue.confirmed):0,predictionLeadLimit:PREDICTION_LEAD_LIMIT,waitReason:queue?.waitReason,
  rollbackCount,music:bgm?{status:bgm.status,id:bgm.active?.id,generation:bgm.generation,audioTime:context?.currentTime,sourceStart:bgm.sourceStart,paused:bgm.paused}:null,frame:queue?.frame,confirmed:queue?.confirmed,state:lastState,boot,hashMatches,steps,waits,endedReason,transport,network:room?.network||network,networkEvents:networkEvents.slice(),display:display?.metrics,audio:audio?.info(),role:auth?.role,slot:auth&&room?room.slots[auth.role]:null,room:auth?.room,
  capabilities:{secure:isSecureContext,subtle:!!globalThis.crypto?.subtle,audioWorklet:!!context?.audioWorklet,offscreen:!!globalThis.OffscreenCanvas}};}};
try{
  const response=await fetch('/api/version'),data=await response.json();if(!response.ok||data.protocol!==PROTOCOL||typeof data.relayAvailable!=='boolean')throw Error('联机服务版本不匹配');
  network??=['public-rtc','public-ws'].includes(data.defaultNetwork)?data.defaultNetwork:'lan';
  version=data;
  if(network==='public-ws'&&!data.relayAvailable){status('公网中继尚未就绪，可选择优先直连，或由部署者安装 requirements-lan.txt 后重启服务。');}
  else status(`${network.startsWith('public-')?'公网':'局域网'}服务已就绪，创建或加入房间。`);
}catch{status('请关闭旧版 TH05 局域网服务，再运行本项目的 start-lan.bat，并刷新页面。');}
render();
$('public-transport').onchange=()=>{if(auth||entering)return;network=$('public-transport').value;render();};
