import {PROTOCOL,TICK_MS,PAUSE,RESUME,GameQueue,inputPolicy as makeInputPolicy,planReplay,nextInputs,PREDICTION_LEAD_LIMIT,ROLLBACK_ARM_AHEAD,MAX_ROLLBACK} from './netplay/protocol.js';
import {createFrameDisplay} from './frame-display.js';
import {LocalAudioOutput} from './netplay/audio-output.js';
import {createRelayChannel} from './netplay/relay-channel.js';
import {mountPlayer} from './player-ui.js';
import {LocalBgm} from './netplay/local-bgm.js';
import {loadRtcConfiguration} from './netplay/connection.js';
import {deploymentIceConfiguration} from './netplay/udp-config.js';
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
const activeRoles=()=>roles.slice(0,room?.settings.players||2);
const remoteRoles=()=>activeRoles().filter(role=>role!==auth?.role);
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
    startup:bootProgress,bootTimings:boot?.bootTimings,performance:perf,music:bgm?.status,connection:pc?.connectionState,channel:channel?.readyState,transport,networkEvents,audio:audio?.info(),display:display?.metrics,state:lastState,endedReason},null,2);
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
    seat.textContent=`P${room.slots[role]+1} · ${role==='host'?'房主':'队友'} · ${room.present[role]?names[room.characters[role]]+' · '+(room.ready[role]?'已准备':'未准备'):'等待加入'}`;
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
      if(error.fatal||(now-pollFailedAt>(connecting?600000:120000)&&channel?.readyState!=='open'))await finish(error.message,false);
      else status(channel?.readyState==='open'?'房间服务暂时不可用；游戏连接继续运行，正在重试。':'房间请求暂时失败，正在重试…');
    }
  }finally{pollBusy=false;}
}
async function enter(action){
  if(entering||auth)return;entering=true;render();
  try{
  const data=await api(action,action==='join'?{room:$('room-code').value.trim()}:{network});
  auth={room:data.room,token:data.token,role:data.role,generation:data.state.generation};
  room=data.state;endedReason=null;networkEvents=[];transport='rtc';fallbackPending=false;render();status(`已${action==='create'?'创建':'加入'}房间 ${auth.room}。请选择角色并准备。`);
  pollFailures=0;pollFailedAt=pollRetryAt=0;
  pollTimer=setInterval(poll,500);
  }finally{entering=false;render();}
}
async function ensureAudio(){
  if(!context||context.state==='closed')context=new AudioContext({sampleRate:44100,latencyHint:'interactive'});
  await context.resume();if(!audio)audio=new LocalAudioOutput(context,1);if(!bgm){bgm=new LocalBgm(context,()=>{});bgm.setVolume(Number($('bgm-volume').value)/100);const currentBgm=bgm;bgm.load({warmOpening:false}).catch(e=>{if(bgm===currentBgm)status('音乐加载失败：'+e.message);});}
  $('sound').textContent=context.state==='running'?'声音已开启':'开启声音';
}
function send(message){if(channel?.readyState!=='open')throw Error('游戏连接已断开');channel.send(JSON.stringify(message));}
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
  hashMatches++;hashes.delete(frame);for(const lane of peerHashes.values())lane.delete(frame);
}
function onPacket(event,source){try{
  if(typeof event.data!=='string'||event.data.length>4096)throw Error('连接消息超出限制');
  const message=JSON.parse(event.data);
  const role=source||message.from;if(!remoteRoles().includes(role))throw Error('未知消息来源');
  lastMessage=performance.now();if(peers.has(role))peers.get(role).lastMessage=lastMessage;
  if(message.type==='hello'){
    if(peerHello.has(role))throw Error('重复开局消息');peerHello.set(role,message);tryLoaded();
  }else if(message.type==='loaded'){
    if(!peerHello.has(role)||peerLoaded.has(role))throw Error('准备消息顺序异常');peerLoaded.add(role);tryGo();
  }else if(message.type==='go'){
    if(role!=='host'||auth.role==='host'||pendingGo)throw Error('非法开局消息');pendingGo=true;tryGo();
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
    if(!peerHashes.has(role))peerHashes.set(role,new Map());const lane=peerHashes.get(role);lane.set(message.frame,message.hash);if(lane.size>8)throw Error('同步检查积压');compare(message.frame);
    if(message.boot)rollbackPeers.add(role);armRollback();
  }else if(message.type==='ping'){
    if(!Number.isSafeInteger(message.id)||message.id<0)throw Error('无效延迟探测');
    send({type:'pong',id:message.id,to:role});
  }else if(message.type==='pong'){
    if(!Number.isSafeInteger(message.id)||!activeRoles().includes(message.to))throw Error('无效延迟应答');
    if(message.to===auth.role){
      const pending=pings.get(message.id);
      if(pending?.roles.delete(role))rtt.set(role,Math.round((performance.now()-pending.at)*10)/10);
      if(pending&&!pending.roles.size)pings.delete(message.id);
    }
  }else if(message.type==='stop'){
    finish(typeof message.reason==='string'?`队友结束本局：${message.reason.slice(0,250)}`:'队友已离开，本局结束。',false);
  }else throw Error('未知连接消息');
}catch(error){finish(error.message);}}
function startHeartbeat(){
  clearInterval(heartbeat);heartbeat=setInterval(()=>{try{
    const now=performance.now();
    if(transport==='relay'?now-lastMessage>(paused?120000:15000):[...peers.values()].some(p=>now-p.lastMessage>(paused?120000:15000)))throw Error('队友长时间无响应，本局结束。');
    const id=++pingSeq;pings.set(id,{at:now,roles:new Set(remoteRoles())});
    for(const [key,value]of pings)if(now-value.at>15000)pings.delete(key);
    send({type:'ping',id});
    if(running)send({type:'input-tail',slot:queue.slot,inputs:[...queue.inputs[queue.slot]].filter(([at])=>at>=queue.frame-32)});
    if(running)diagnostics();
  }catch(error){finish(error.message);}},1000);
}
function meshChannel(){
  return {ordered:true,maxRetransmits:null,maxPacketLifeTime:null,
    get readyState(){return remoteRoles().every(role=>peers.get(role)?.channel?.readyState==='open')?'open':'connecting';},
    get bufferedAmount(){return Math.max(0,...[...peers.values()].map(peer=>peer.channel?.bufferedAmount||0));},
    send(data){for(const role of remoteRoles()){const c=peers.get(role)?.channel;if(c?.readyState!=='open')throw Error('游戏连接已断开');c.send(data);}},
    close(){for(const peer of peers.values())peer.channel?.close();}};
}
function attachChannel(value,role){
  const peer=peers.get(role);
  if(!peer||peer.channel)throw Error('重复游戏连接');peer.channel=value;
  if(!value.ordered||value.maxRetransmits!==null||value.maxPacketLifeTime!==null)throw Error('游戏需要可靠有序连接');
  value.onmessage=event=>{if(peers.get(role)===peer)onPacket(event,role);};
  value.onclose=()=>{if(peers.get(role)===peer&&auth)networkFailure('连接已关闭');};
  value.onerror=event=>{if(peers.get(role)===peer)networkFailure(event.error?.message||'游戏数据通道发生错误');};
  value.onopen=()=>{
    if(peers.get(role)!==peer||!auth)return;
    peer.lastMessage=performance.now();
    if(room?.transport==='relay'){switchRelay();return;}
    try{if(boot)value.send(JSON.stringify(hello()));if(channel.readyState==='open'){clearTimeout(rtcTimeout);startHeartbeat();tryLoaded();}}catch(error){networkFailure(error.message);}
  };
}
function closeTransport(){
  clearInterval(heartbeat);clearTimeout(rtcTimeout);
  if(relay){relay.onopen=relay.onclose=relay.onerror=relay.onmessage=null;relay.close();relay=null;}
  const previous=[...peers.values()];peers.clear();
  for(const peer of previous){const c=peer.channel;if(c){c.onopen=c.onclose=c.onerror=c.onmessage=null;c.close();}peer.pc.onconnectionstatechange=peer.pc.ondatachannel=null;peer.pc.close();}
  channel=null;pc=null;
}
function networkFailure(message,detail={}){
  networkEvents.push({message,...detail,transport,rollbackEnabled:room?.settings.rollback,rollbackCount,music:bgm?.status,connection:pc?.connectionState,ice:pc?.iceConnectionState,channel:channel?.readyState,atMs:Math.round(performance.now())});
  if(networkEvents.length>10)networkEvents.shift();diagnostics();
  if(!running&&transport==='rtc'){requestRelay(message);return;}
  finish(`${transport==='relay'?'联机中继':'游戏数据通道'}连接失败：${message}。本局结束。`,false);
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
  relay=createRelayChannel(auth);channel=relay;
  const currentRelay=relay,identity=auth;
  relay.onmessage=event=>{if(relay===currentRelay)onPacket(event);};
  relay.onclose=()=>{if(relay===currentRelay&&auth)networkFailure('中继连接已关闭');};
  relay.onerror=event=>{if(relay===currentRelay)networkFailure(event.error?.message||'中继连接错误');};
  relay.onopen=()=>{if(auth!==identity||relay!==currentRelay)return;try{clearTimeout(rtcTimeout);lastMessage=performance.now();if(boot)send(hello());startHeartbeat();}catch(error){networkFailure(error.message);}};
  status('正在通过服务建立联机连接…');
  rtcTimeout=setTimeout(()=>{if(auth===identity)networkFailure('联机中继连接超时');},15000);diagnostics();
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
  let directRelay=room.transport==='relay',rtcConfiguration=null;
  rtcPreparing=!directRelay;
  if(!directRelay){
    const source=globalThis.th05NetplayUdp??globalThis.th05NetplayConnection??(room.network==='public-rtc'?deploymentIceConfiguration:undefined);
    rtcConfiguration=await loadRtcConfiguration(identity,source);
    if(current!==epoch||auth!==identity)return;
    directRelay=room.transport==='relay';
  }
  if((directRelay?!globalThis.WebSocket:!globalThis.RTCPeerConnection)||!globalThis.Worker||!globalThis.OffscreenCanvas||!globalThis.DecompressionStream)throw Error('此浏览器缺少联机运行能力，请使用新版 Edge / Chrome。');
  if(transport!=='relay')channel=meshChannel();
  for(const role of directRelay?[]:remoteRoles()){
    const connection=new RTCPeerConnection(rtcConfiguration);
    const peer={role,pc:connection,channel:null,lastMessage:performance.now(),signalChain:Promise.resolve()};peers.set(role,peer);
    if(!pc)pc=connection;
    connection.ondatachannel=event=>{if(auth!==identity||peers.get(role)!==peer)return;try{
      if(roles.indexOf(identity.role)<roles.indexOf(role))throw Error('意外的数据通道');attachChannel(event.channel,role);
    }catch(error){finish(error.message);}};
    connection.onconnectionstatechange=()=>{if(auth===identity&&peers.get(role)===peer&&connection.connectionState==='failed')networkFailure('WebRTC 连接失败');};
  }
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
      else if(data.type==='audio')audio?.push([data.samples]);
      else if(data.type==='music'){for(const [ax,hash]of data.events)bgm?.command(ax,hash);}
      else if(data.type==='hash'){hashes.set(data.frame,data.hash);if(hashes.size>8)throw Error('同步检查积压');send({type:'hash',frame:data.frame,hash:data.hash,boot:data.boot});compare(data.frame);armRollback();}
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
    }catch(error){finish(error.message);}
  };
  const config={rank:room.settings.rank,players:[]};
  for(const role of activeRoles())config.players[room.slots[role]]={character:room.characters[role],spares:room.settings.spares,bombs:room.settings.bombs};
  worker.postMessage({type:'boot',settings:room.settings,config,viewSlot:room.slots[auth.role]});
if(room?.transport==='relay'){switchRelay();return;}
  await Promise.all(remoteRoles().filter(role=>roles.indexOf(identity.role)<roles.indexOf(role)).map(async role=>{
    const peer=peers.get(role);if(!peer||transport!=='rtc'||auth!==identity)return;
    const connection=peer.pc;
    try{
      attachChannel(connection.createDataChannel('th05-input',{ordered:true}),role);
      await connection.setLocalDescription(await connection.createOffer());await completeIce(connection);
      if(current!==epoch||peers.get(role)!==peer||transport!=='rtc')return;
      await api('signal',{to:role,signal:connection.localDescription.toJSON()},identity);
    }catch(error){if(auth===identity&&transport==='rtc')requestRelay(error.message);}
  }));
}
async function receiveSignal(envelope){
  if(!auth||room?.transport==='relay'||transport==='relay')return;
  if(rtcPreparing){if(pendingSignals.length>=16)throw Error('等待连接配置时收到过多信令');pendingSignals.push(envelope);return;}
  const role=envelope.from,signal=envelope.signal,peer=peers.get(role),identity=auth;
  if(!peer||!signal)throw Error('未知信令来源');
  peer.signalChain=peer.signalChain.then(async()=>{
    if(auth!==identity||peers.get(role)!==peer||transport!=='rtc')return;
    const connection=peer.pc,offerer=roles.indexOf(identity.role)<roles.indexOf(role);
    if(connection.remoteDescription)throw Error('重复连接描述');
    if(signal.type==='offer'&&!offerer){
      await connection.setRemoteDescription(signal);await connection.setLocalDescription(await connection.createAnswer());await completeIce(connection);
      if(auth===identity&&peers.get(role)===peer&&transport==='rtc')await api('signal',{to:role,signal:connection.localDescription.toJSON()},identity);
    }else if(signal.type==='answer'&&offerer)await connection.setRemoteDescription(signal);
    else throw Error('连接消息与身份不一致');
  }).catch(error=>{if(auth===identity&&transport==='rtc')requestRelay(error.message);});
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
  if(!running||auth.role!=='host'||!sessionPolicy.rollbackEnabled||queue.activation!==null||!runtimePolicy.ready||!remoteRoles().every(role=>rollbackPeers.has(role)))return;
  const frame=queue.frame+ROLLBACK_ARM_AHEAD;queue.arm(frame);send({type:'rollback',frame});
}
function confirmFrames(){
  if(queue.dirty!==null)return;
  const prefix=Math.min(queue.confirmed,queue.frame);
  if(prefix>committedPrefix){worker.postMessage({type:'confirm',prefix});committedPrefix=prefix;queue.prune();}
  armRollback();
}
function pump(){try{
  if(!running||busy)return;
  if(channel.bufferedAmount>65536)throw Error('网络发送积压，本局停止。');
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
  worker.postMessage({type:'step',frame:queue.frame,pair,predicted:queue.active&&queue.frame>=queue.confirmed});
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
  performance:performanceInfo(),
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
