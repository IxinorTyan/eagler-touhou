import {nativePlayers} from './native-players.js';
import {createGameLocator} from './game-locator.js';
import {installAfterimageArt,loadAfterimageArt} from './afterimage-art.js';
import {createPersonalHud} from './personal-hud.js';
import './frame-presenter.js';
import './sidebar-background.js';
import {gameFiles} from './disk-files.js';
import {installConfig} from './launch-config.js';
import {sha256} from './netplay/sha256.js';
import {PAUSE,RESUME,REPLAY_MAX_STEPS,REPLAY_BUDGET_MS} from './netplay/protocol.js';
import {loadVerifiedBytes,loadCompiledCore} from './startup-assets.js';
import {yieldHost} from './host-yield.js';
import {writeNativeTouch,nativeHitPoints} from './native-touch.js';
let pointInputs=[0,0];
import {installMusicFiles,loadMusicAssets} from './music-files.js';
import {NativeMusic} from './solo-native-music.js';
import {createDosboxSnapshots} from './dosbox-snapshots.js';
import {makeMemoryDiff} from './dosbox-memory-diff.js';
let snapshots=null,shim=null,music=null,effect=null,confirmed=0,replaying=false,rollbackCount=0;
let restoredBoundary=null;
const saved=new Map(),effects=new Map();
const rollbackMetrics={captures:0,captureMs:0,sharedCaptures:0,checkpointReplays:0,restores:0,restoreMs:0,resimulated:0,replayMs:0,simulateMs:0,confirmMs:0,slices:0,maxSliceSteps:0,maxSliceMs:0};

let mod,ci,patch,mailbox=-1,guestBase=-1,tick=0,frame=0,oldP1=0,paused=false,warming=true,fatal=false;
let escapeTicks=0,lastPauseRequests=0;
let frames=0,audioPackets=0,audioEnergy=0,lastStateSent=0;
let sfxEvents=0;
const transfers=new Set(),costs=[],signature=new TextEncoder().encode('TH05LOCALv002!!\0');
const keys={ArrowUp:[1,265],ArrowDown:[2,264],ArrowLeft:[4,263],ArrowRight:[8,262],KeyX:[16,88],KeyZ:[32,90],ShiftLeft:[64,340],Escape:[128,256],Enter:[256,257]};
const send=(type,props={},transfer=[])=>postMessage({type,...props},transfer);
function fail(error){if(fatal)return;fatal=true;send('error',{message:error?.message||String(error)});}
addEventListener('error',e=>fail(e.error||e.message));
addEventListener('unhandledrejection',e=>fail(e.reason));
const gameLocator=createGameLocator();
function scan(){
  const h=mod.HEAPU8,v=new DataView(h.buffer);
  if(mailbox>=0&&signature.every((n,i)=>h[mailbox+i]===n)&&h[mailbox+25]===1)return;
  mailbox=-1;
  mod.nativeExports().th05_set_idle_pc?.(-1);
  // Gameplay/rollback must not depend on a host-side discovery counter.
  // Runtime invalidation is rare: use the original fresh-scan behavior there.
  const found=gameLocator.find(h,patch,!warming);
  if(found){
    [mailbox,guestBase]=found;
    // The verified MAIN image uses CS = image + 0xAE10. Its VSync loop
    // starts at CS:0011, before the inserted payload in both CN and JP.
    const at=mailbox-patch.mailbox_cs_offset+0x11;
    const code=[0xa1,0x7a,0x26,0x3b,0x06,0x6a,0x57,0x72,0xf7];
    if(patch.code_segment===0xae1&&code.every((byte,i)=>h[at+i]===byte))mod.nativeExports().th05_set_idle_pc?.(at-guestBase);
  }
  mod.afterimageArt?.bind(mailbox);
}
function nativePause(){return mailbox<0?0:mod.HEAPU8[mailbox-patch.mailbox_cs_offset+patch.native_pause_cs_offset];}
function controlState(){
  if(mailbox<0)return null;
  const heap=mod.HEAPU8;
  return {generation:new DataView(heap.buffer).getUint16(mailbox+26,true),paused:nativePause()!==0,
    players:nativePlayers(heap,mailbox,patch).players.map(({ghost,miss,entry})=>({ghost:!!ghost,miss:!!miss,entry:!!entry}))};
}
function state(){
  if(mailbox<0)return null;const h=mod.HEAPU8,v=new DataView(h.buffer),p=patch.mailbox_offsets;
  const d=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
  const layout=nativePlayers(h,mailbox,patch);
  return {observedAt:performance.timeOrigin+performance.now(),ticks:v.getUint32(mailbox+16,true),stageFrame:v.getUint16(mailbox+36,true),
    p1:[v.getInt16(mailbox+28,true)/16,v.getInt16(mailbox+30,true)/16],p2:[v.getInt16(mailbox+32,true)/16,v.getInt16(mailbox+34,true)/16],
players:layout.players,playerCount:layout.count,characters:layout.characters,
    ...Object.fromEntries(layout.positions.map((xy,i)=>['p'+(i+1),xy])),
    rank:h[d+0x576f],stage:h[d+0x576e],generation:v.getUint16(mailbox+26,true),nativeTick:tick,frame,paused,frames,audioPackets,audioEnergy,rollbackCount,confirmed,rollback:snapshots?{...snapshots.info(),checkpointFrames:2}: {snapshots:0,snapshotBytes:0},
    heapBytes:h.length,writeJournal:!!mod.thDirty,render:mod.framePresenter,sidebarBlack:mod.sidebarBlack,costs:costs.slice(),sfxEvents,audioMode:'local-effects',
    syncPolicy:syncPolicy(),rollbackMetrics:{...rollbackMetrics}};
}
function syncPolicy(){
  let blockReason='';
  if(mailbox<0||warming)blockReason='游戏启动尚未完成';
  else if(paused)blockReason='原生暂停菜单';
  else{
    const h=mod.HEAPU8,code=mailbox-patch.mailbox_cs_offset,count=h[code+patch.entry_map.player_count];
    if(Array.from({length:count},(_,slot)=>h[code+patch.entry_map.out_flags+slot]).every(Boolean))blockReason='原生续关菜单';
  }
  return {ready:!!snapshots&&mailbox>=0&&!warming,canPredict:!blockReason,blockReason};
}
function checksum(){
  let hash=2166136261;const h=mod.HEAPU8;
  for(let at=guestBase;at<guestBase+0xa0000;at++)hash=Math.imul(hash^h[at],16777619);
  for(const n of [tick,oldP1,paused?1:0,escapeTicks,lastPauseRequests,frame])hash=Math.imul(hash^n,16777619);
  return (hash>>>0).toString(16).padStart(8,'0');
}
function step(){
  tick++;mod.targetNow=Math.max(mod.virtualNow,Math.floor(tick*1000/60));let safety=0;
  while(mod.wakeAt<=mod.targetNow){if(++safety>1000)throw Error('同步步骤未让出执行');mod.virtualNow=Math.max(mod.virtualNow,mod.wakeAt);mod.advanceNative();}
  mod.virtualNow=mod.targetNow;if(!mod.pendingWake)throw Error('核心未在同步边界挂起');
}
function input(pair){
  pointInputs=pair;
  const combined=pair.reduce((bits,value)=>bits|value%4096,0);
  let requests=0,wantsPause=false,wantsResume=false,toggle=false;
  for(let slot=0;slot<pair.length;slot++){
    const value=pair[slot],kind=(value&128?1:0)|(value&PAUSE?2:0)|(value&RESUME?4:0);
    const fresh=kind&~(lastPauseRequests>>>(slot*3)&7);requests|=kind<<(slot*3);
    toggle||=!!(fresh&1);wantsPause||=!!(fresh&2);wantsResume||=!!(fresh&4);
  }
  // A background-tab pause cannot accidentally close an already open menu.
  if(wantsPause?!paused:(toggle||(wantsResume&&paused)))escapeTicks=6;
  lastPauseRequests=requests;
  // Any seat can operate the real pause menu. Outside it, gameplay inputs
  // remain independent. Hold an Esc pulse until the native menu has seen it.
  const p1=((paused?combined:pair[0])&(127|256))|(escapeTicks>0?128:0);
  if(escapeTicks>0)escapeTicks--;
  for(const [code,[bit,number]] of Object.entries(keys))if((oldP1^p1)&bit)ci.addKey(number,!!(p1&bit),mod.virtualNow);
  oldP1=p1;shim.keys=new Set(Object.values(keys).filter(([bit])=>p1&bit).map(([,number])=>number));const h=mod.HEAPU8,v=new DataView(h.buffer);
  if(mailbox<0)return;
  v.setUint16(mailbox+22,pair[1]&63,true);h[mailbox+24]=pair[1]&64?1:0;v.setUint16(mailbox+patch.mailbox_offsets.p3_input,(pair[2]||0)&63,true);h[mailbox+patch.mailbox_offsets.p3_focus]=(pair[2]||0)&64?1:0;h[mailbox+patch.mailbox_offsets.invincible]=0;writeNativeTouch(h,mailbox,patch,pair,paused);
}
async function boot(data){
  const bootStarted=performance.now(),timings={};
  const progress=(stage,message)=>send('boot-progress',{stage,message});
  const viewSlot=data.viewSlot;
  progress('resources','正在并行加载游戏与核心…');
  const vendor=new URL('vendor/dosbox-net/',import.meta.url);
  const [patchResponse,manifestResponse]=await Promise.all([fetch(`patch-${data.settings.language}.json`,{cache:'no-store'}),fetch(new URL('runtime.json',vendor),{cache:'no-store'})]);
  if(!patchResponse.ok||!manifestResponse.ok)throw Error('游戏或核心清单读取失败');
  const manifest=await manifestResponse.json();patch=await patchResponse.json();
  if(!Number.isInteger(patch.native_pause_cs_offset))throw Error('请更新原生暂停资源并刷新页面');
  const tracked=!!data.settings.rollback&&WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,5,5,2,0,1,0,1]));
  const core=tracked?'wdosbox-x-rollback-tracked.wasm':'wdosbox-x-rollback.wasm';
  const glue=tracked?'dosbox-rollback-tracked.mjs':'dosbox-rollback.mjs';
  const dispatch=onmessage;
  const [disk,compiledCore,musicAssets,factory,afterimageBytes]=await Promise.all([
    loadVerifiedBytes(new URL(`th05-local-${data.settings.language}.hdi.gz`,import.meta.url),patch.sha256,{gzip:true,size:patch.size,
      report:phase=>progress('disk',phase==='cache'?'已读取已校验磁盘缓存':phase==='verify'?'正在校验游戏磁盘…':'正在下载并解压游戏磁盘…')}),
    loadCompiledCore(new URL(core,vendor),manifest.files[core],phase=>progress('core',phase==='compiled-cache'?'已读取编译核心缓存':phase==='compile'?'正在编译联机核心…':phase==='verify'?'正在校验联机核心…':phase==='cache'?'已读取核心资源缓存':'正在下载联机核心…')),
    loadMusicAssets({effects:true}),
    (async()=>{try{await import('./vendor/dosbox-net/emulators.js');return (await import(new URL(glue,vendor).href)).default;}finally{onmessage=dispatch;}})(),
    loadAfterimageArt(patch),
  ]);
  timings.resourcesMs=performance.now()-bootStarted;
  progress('native','正在初始化 PC-98 与本局配置…');
  installConfig(disk,patch,data.config);
  const files=gameFiles(disk),musicPatch=await installMusicFiles(files,{assets:musicAssets}),launcher=files.find(f=>f.path==='game/KAIKI/FAST.BAT');music=new NativeMusic(musicPatch);
  let batch=new TextDecoder().decode(launcher.contents);
  if(batch.split('\r\nmain\r\n').length!==2)throw Error('启动脚本版本不匹配');
  batch=batch.replace('\r\nmain\r\n','\r\nz:\\system\\config.com -set "cpu cycles=30000"\r\nmain\r\n');
  files.push({path:'game/KAIKI/FASTBOOT.BAT',contents:new TextEncoder().encode(batch)});
  const NativeDate=Date;
  class VirtualDate extends NativeDate{
    constructor(...args){super(...(args.length?args:[946684800000+(mod?.virtualNow||0)]));}
    static now(){return 946684800000+(mod?.virtualNow||0);}
    getTimezoneOffset(){return 0;}getFullYear(){return this.getUTCFullYear();}getMonth(){return this.getUTCMonth();}
    getDate(){return this.getUTCDate();}getDay(){return this.getUTCDay();}getHours(){return this.getUTCHours();}
    getMinutes(){return this.getUTCMinutes();}getSeconds(){return this.getUTCSeconds();}
  }
  const messages=[];let receiver;
  mod={canvas:new OffscreenCanvas(640,400),instantiateWasm:(imports,receive)=>receive(new WebAssembly.Instance(compiledCore,imports),compiledCore),virtualDate:VirtualDate,virtualNow:0,targetNow:0,deterministic:true,nativeScheduling:true,nativeCpu:true,nativeFramePresentation:false,
    deferPresentation:true,
    SDL2:{audioContext:{sampleRate:44100}},locateFile:name=>new URL(name==='wdosbox-x-jspi.wasm'?core:name,vendor).href,
    postMessage:(name,props)=>{if(receiver)receiver(name,props);else messages.push([name,props]);},onAbort:fail};
  mod.installFramePresenter=()=>{
    mod.getPersonalHud=createPersonalHud(()=>mailbox<0||nativePause()?null:{heap:mod.HEAPU8,mailbox,patch},()=>viewSlot);
    mod.getHitPoints=()=>nativePause()?[]:nativeHitPoints(mod.HEAPU8,mailbox,patch,pointInputs);
    mod.onFrameRendered=(_ptr,width,height,seq)=>{
      frames++;
      if(warming){mod.framePresenter.bootSuppressed=(mod.framePresenter.bootSuppressed||0)+1;return;}
      if(transfers.size>=4){mod.framePresenter.backpressureDropped++;return;}
      const bitmap=mod.canvas.transferToImageBitmap();transfers.add(seq);mod.framePresenter.transferred++;
      send('frame',{bitmap,width,height,seq,producedAt:performance.timeOrigin+performance.now()},[bitmap]);
    };
    mod.getSidebarBackground=()=>mailbox<0?null:sidebarBackground(mod.HEAPU8.subarray(
      mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16+0x264a,
      mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16+0x267a));
    mod.framePresenter=installFramePresenter(mod,'bitmap');
  };
  const transport={sessionId:'th05-lan',module:mod,net:null,exit:()=>{},
    sendMessageToServer:(name,props)=>mod.messageHandler({data:{name,props}}),
    initMessageHandler:handler=>{receiver=handler;for(const msg of messages)handler(...msg);messages.length=0;}};
  await factory(mod);mod.callMain([transport.sessionId]);
  const config='[dosbox]\nmachine=pc98\nmemsize=16\n[cpu]\ncore=simple\ncputype=386\ncycles=1000\n[render]\nframeskip=0\nscaler=none\naspect=false\n[sblaster]\nsbtype=none\n[pc98]\npc-98 fm board=board86\n[mixer]\nrate=44100\nblocksize=512\nprebuffer=20\n[autoexec]\n@echo off\nmount a /home/web_user/game\na:\ncd KAIKI\nFASTBOOT.BAT\n';
  ci=await emulators.backend([...files,{dosboxConf:config,jsdosConf:{version:'8'}}],transport,{});
  mod.afterimageArt=await installAfterimageArt(mod,patch,afterimageBytes);
  // The native mixer still advances deterministically, but its silent PCM is
  // no longer copied, retained in rollback effects, or transferred per frame.
  ci.events().onSoundPush(()=>{if(!warming)audioPackets++;});
  shim={module:mod,ci,keys:new Set(),get tick(){return tick;},set tick(value){tick=value;}};
  ci.events().onMessage((type,...args)=>{if(type==='error'&&args.some(s=>String(s).includes('[panic]')))fail(Error(args.join(' ')));});
  ci.events().onExit(()=>fail(Error('游戏核心已退出')));
  const started=performance.now();
  timings.initializationMs=started-bootStarted-timings.resourcesMs;
  let yieldedAt=started,reportedAt=0;
  timings.scanMs=0;timings.stepMs=0;timings.bootSteps=0;
  for(let n=0;n<18000&&mailbox<0;n++){
    const stepAt=performance.now();step();timings.stepMs+=performance.now()-stepAt;timings.bootSteps++;
    if(n%15===0&&mod.UTF8ToString(mod._emGetRunningProgram()).toUpperCase()==='MAIN'){const scanAt=performance.now();scan();timings.scanMs+=performance.now()-scanAt;}
    const now=performance.now();
    if(now-reportedAt>=500){progress('native',`正在执行 DOS／游戏启动：${(tick/60).toFixed(1)} 模拟秒`);reportedAt=now;}
    if(now-yieldedAt>=16){await yieldHost();yieldedAt=performance.now();}
  }
  if(mailbox<0)throw Error('游戏启动超时');
  if(mod.UTF8ToString(mod._getCPUMetrics()).split('|')[0]!=='30000')throw Error('固定 CPU 配置未生效');
  const musicSegment=new DataView(mod.HEAPU8.buffer).getUint16(guestBase+0x60*4+2,true);
  music.at=guestBase+musicSegment*16+musicPatch.mailbox_com_offset;
  music.read(mod.HEAPU8);
  // Preserve all startup commands, including the opening Play, for frame zero.
  music.sequence=0;
  if(data.settings.rollback){mod.memoryDiff=await makeMemoryDiff(mod,manifest.files[tracked?'snapshot-diff-tracked.wasm':'snapshot-diff.wasm']);snapshots=createDosboxSnapshots(shim);}
  warming=false;
  mod.framePresenter.flush();
  // Both variants execute the same pinned machine. The build fingerprint
  // covers both resources; allow capable and fallback clients in one room.
  timings.nativeBootMs=performance.now()-started;
  timings.locator={...gameLocator.metrics};
  send('ready',{state:state(),bootMs:performance.now()-bootStarted,bootTimings:timings,checksum:checksum(),guestSha:await sha256(mod.HEAPU8.slice(guestBase,guestBase+0xa0000)),diskSha:patch.sha256,
    coreSha:manifest.files['wdosbox-x-rollback.wasm'],executionCoreSha:manifest.files[core]});
}
function advance(pair,predicted=true,offlineMask=0){
  const started=performance.now();
  if(snapshots&&predicted){
    const captureAt=performance.now();
    // Share a complete native checkpoint across two adjacent predicted ticks.
    // Keep each tick's host state and input so the second boundary is exact.
    const previous=saved.get(frame-1),nativeFrame=previous?.nativeFrame===frame-1?frame-1:frame;
    if(nativeFrame===frame){snapshots.capture(frame,restoredBoundary===frame);rollbackMetrics.captures++;}
    else rollbackMetrics.sharedCaptures++;
    saved.set(frame,{nativeFrame,oldP1,paused,escapeTicks,lastPauseRequests,frame,mailbox,guestBase,music:music.capture(),execution:pair.slice(),offlineMask});
    rollbackMetrics.captureMs+=performance.now()-captureAt;
  }
  restoredBoundary=null;
  const simulateAt=performance.now();
  effect={sfx:[],music:[],paused,transition:false,exit:false,hash:null};
  const before=paused;
  scan();
  // Cover direct DataView, touch and mailbox writes in the guest window.
  if(guestBase>=0)mod.thDirtyMark?.(guestBase,1048576);
  if(!Number.isInteger(offlineMask)||offlineMask<0||offlineMask>7)throw Error('离线席位掩码无效');
  if(mailbox>=0){
    const c=mailbox-patch.mailbox_cs_offset,h=mod.HEAPU8;
    h[c+patch.entry_map.offline_mask]=offlineMask;
    // Also apply at the suspended menu boundary, before the next native tick.
    for(let slot=0;slot<3;slot++)if(offlineMask&(1<<slot))h[c+patch.entry_map.out_flags+slot]=2;
  }
  input(pair);step();
  paused=nativePause()!==0;
  if(before!==paused)escapeTicks=0;
  effect.exit=nativePause()===2;
  for(const event of music.read(mod.HEAPU8)){
    if((event[0]>>>8)===0x0c)effect.sfx.push({frame,id:event[0]&255});
    else effect.music.push(event);
  }
  effect.paused=paused;effect.transition=before!==paused;
  effects.set(frame,effect);frame++;effect.hash=frame%120===0?checksum():null;
  if(predicted)snapshots?.seal();effect=null;
  rollbackMetrics.simulateMs+=performance.now()-simulateAt;
  if(!replaying){costs.push(performance.now()-started);if(costs.length>180)costs.shift();}
}
function confirm(prefix){
  const started=performance.now();
  let exit=false,sfx=[];
  if(!Number.isSafeInteger(prefix)||prefix<confirmed||prefix>frame)throw Error('确认边界无效');
  for(let n=confirmed;n<prefix;n++){
    const e=effects.get(n);if(!e)throw Error('确认帧缺少音效状态');
    if(e.transition){if(sfx.length){send('sfx',{events:sfx});sfx=[];}send('pause-state',{paused:e.paused});}
    exit||=e.exit;
    sfx.push(...e.sfx);sfxEvents+=e.sfx.length;
    if(e.music.length)send('music',{events:e.music});
    if(e.hash)send('hash',{frame:n+1,hash:e.hash,boot:syncPolicy().ready});
    effects.delete(n);
  }
  if(sfx.length)send('sfx',{events:sfx});
  // Keep the first boundary until its second tick is confirmed, even if the
  // first tick's effects have already been delivered.
  const pending=saved.get(prefix),previous=saved.get(prefix-1);
  const retain=pending?.nativeFrame??(previous?.nativeFrame===prefix-1?prefix-1:prefix);
  confirmed=prefix;snapshots?.confirm(prefix,retain);
  for(const n of saved.keys())if(n<retain)saved.delete(n);
  rollbackMetrics.confirmMs+=performance.now()-started;
  if(exit){fatal=true;send('session-exit',{frame:prefix});}
}
onmessage=async({data})=>{try{
  if(fatal)return;
  if(data.type==='boot'){await boot(data);return;}
  if(data.type==='frame-ack'){transfers.delete(data.seq);return;}
  if(data.type==='confirm'){confirm(data.prefix);return;}
  if(data.type==='restore'){
    const started=performance.now();
    if(!snapshots||!saved.has(data.frame)||data.frame<confirmed)throw Error('回滚状态已过期');
    const target=data.frame,from=saved.get(target).nativeFrame,s=saved.get(from);
    if(!s||(from!==target&&!s.execution))throw Error('回滚检查点缺失');
    snapshots.restore(from);
    ({oldP1,paused,escapeTicks,lastPauseRequests,frame,mailbox,guestBase}=s);music.restore(s.music);restoredBoundary=from;
    for(const n of saved.keys())if(n>=from)saved.delete(n);
    for(const n of effects.keys())if(n>=from)effects.delete(n);
    if(from!==target){
      // The queue selected the earliest changed tick, so the preceding tick's
      // original input is immutable. Rebuild it without output or sampling.
      replaying=true;mod.suppressPresentation=true;
      try{advance(s.execution,true,s.offlineMask);}finally{mod.suppressPresentation=false;replaying=false;}
      rollbackMetrics.checkpointReplays++;
      if(from<confirmed)effects.delete(from); // Already committed exactly once.
    }
    rollbackCount++;rollbackMetrics.restores++;rollbackMetrics.restoreMs+=performance.now()-started;
    send('restored',{frame,policy:syncPolicy(),control:controlState()});return;
  }
  if(data.type==='replay-slice'){
    if(data.frame!==frame||!Array.isArray(data.plans)||!data.plans.length||data.plans.length>REPLAY_MAX_STEPS)throw Error('回滚补算批次无效');
    const started=performance.now();let applied=0,finished=false;
    replaying=true;mod.suppressPresentation=true;
    try{
      for(const plan of data.plans){
        if(applied&&performance.now()-started>=REPLAY_BUDGET_MS)break;
        if(plan.frame!==frame)throw Error('回滚补算帧顺序异常');
        if(!plan.authoritative&&!syncPolicy().canPredict)break;
        advance(plan.pair,plan.predicted,plan.offlineMask);applied++;finished=plan.end;
      }
    }finally{mod.suppressPresentation=false;replaying=false;}
    const sliceMs=performance.now()-started;
    rollbackMetrics.resimulated+=applied;rollbackMetrics.replayMs+=sliceMs;
    rollbackMetrics.slices++;rollbackMetrics.maxSliceSteps=Math.max(rollbackMetrics.maxSliceSteps,applied);rollbackMetrics.maxSliceMs=Math.max(rollbackMetrics.maxSliceMs,sliceMs);
    if(finished)mod.framePresenter.flush();
    send('replayed',{frame,applied,policy:syncPolicy(),control:controlState(),state:finished?state():null});return;
  }
  if(data.type==='step'){
    if(data.frame!==frame)throw Error('同步帧顺序异常');
    advance(data.pair,data.predicted,data.offlineMask);
    // Keep the final image of this step; intermediate native updates still run.
    mod.framePresenter.flush();
    const now=performance.now(),publish=frame%30===0||now-lastStateSent>=1000;
    if(publish)lastStateSent=now;
    send('stepped',{frame,policy:syncPolicy(),control:controlState(),state:publish?state():null});
  }
}catch(error){fail(error);}};
