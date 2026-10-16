/* Real DOSBox-X / PC-98 core, kept off the page's input/render scheduling. */
let nativeTouch=null,nativeLayout=null,musicReader=null,gameLocator=null;
let ci,mod,patch,mailbox=-1,guestBase=-1,paused=false,input={p2:0,slow:0,invincible:false},statePending=false,scanDue=0,qaEnabled=false;
let frames=0,audioPackets=0,audioEnergy=0,fatal=false,exited=false,logs=[];
let presentationActive=true,frameProof=null,frameProofHolding=false;
let viewSlot=0;
let soloMode=false,soloInput=null;
const frameTransfers=new Set();
let p2Pulse=0,p2PulseTick=-1,p3Pulse=0,p3PulseTick=-1;
const keyPressTicks=new Map(),deferredKeyUps=new Set();
const nativeInputTick=()=>soloMode?(soloInput?.snapshot?.ticks??-1):mailbox<0?-1:new DataView(mod.HEAPU8.buffer).getUint32(mailbox+16,true);
function releaseConsumedKeys(){
  const current=nativeInputTick();
  for(const code of deferredKeyUps)if(current!==keyPressTicks.get(code)||(soloMode&&soloInput?.snapshot?.mode!==1)){
    ci.sendKeyEvent(code,false);deferredKeyUps.delete(code);keyPressTicks.delete(code);
  }
}
const signature=new TextEncoder().encode('TH05LOCALv002!!\0');
const send=(type,props={})=>postMessage({type,...props});
const emitError=e=>{if(fatal)return;fatal=true;send('error',{message:e?.stack||e?.message||String(e)});};
addEventListener('error',e=>emitError(e.error||e.message));
addEventListener('unhandledrejection',e=>emitError(e.reason));
function scan(){
  if(soloMode){soloInput?.read(mod.HEAPU8);releaseConsumedKeys();return;}
  if(!mod)return;const h=mod.HEAPU8,v=new DataView(h.buffer);
  if(mailbox>=0&&signature.every((b,i)=>h[mailbox+i]===b)&&h[mailbox+25]===1)return;
  mailbox=-1;guestBase=-1;
  if(mod.UTF8ToString(mod._emGetRunningProgram()).toUpperCase()!=='MAIN')return;
  if(performance.now()<scanDue)return;scanDue=performance.now()+64;
  const found=gameLocator.find(h,patch);
  if(found)[mailbox,guestBase]=found;
  mod.afterimageArt?.bind(mailbox);
}
function inputs(){if(mailbox<0)return;const h=mod.HEAPU8,v=new DataView(h.buffer);releaseConsumedKeys();if(nativeInputTick()!==p2PulseTick)p2Pulse=0;v.setUint16(mailbox+22,(input.p2|p2Pulse)&63,true);h[mailbox+24]=input.slow?1:0;
    if(nativeInputTick()!==p3PulseTick)p3Pulse=0;
    v.setUint16(mailbox+patch.mailbox_offsets.p3_input,((input.p3||0)|p3Pulse)&63,true);
    h[mailbox+patch.mailbox_offsets.p3_focus]=input.slow3?1:0;h[mailbox+patch.mailbox_offsets.invincible]=input.invincible?1:0;}
function nativeStatus(){
  if(soloMode){const mode=soloInput?.snapshot?.mode;return {paused:mode===2,exit:mode===3};}
  const flag=mailbox<0?0:mod.HEAPU8[mailbox-patch.mailbox_cs_offset+patch.native_pause_cs_offset];
  return {paused:flag!==0,exit:flag===2};
}
function exitSession(){if(exited)return;exited=true;paused=true;ci?.pause();send('game-exit');}
function state(){
  if(soloMode)return {solo:true,...(soloInput?.snapshot||{mode:0}),program:mod.UTF8ToString(mod._emGetRunningProgram()).toUpperCase(),
    core:'DOSBox-X JSPI',executionThread:'worker',frames,render:mod.framePresenter,audioPackets,audioEnergy,paused,nativePaused:nativeStatus().paused};
  if(mailbox<0)return null;const h=mod.HEAPU8,v=new DataView(h.buffer),at=mailbox,p=patch.mailbox_offsets;
  if(h[at+39]&1)return null;
  const d=at-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
  const layout=nativeLayout(h,at,patch),players=layout.players;
  let active=0,clouds=0;for(let i=0;i<400;i++){const n=d+0x5f2a+i*32;if(h[n]===1){active++;if(h[n+18]>3)clouds++;}}
  return {ticks:v.getUint32(at+16,true),ds:v.getUint16(at+20,true),generation:v.getUint16(at+26,true),
    p1:[v.getInt16(at+28,true)/16,v.getInt16(at+30,true)/16],p2:[v.getInt16(at+32,true)/16,v.getInt16(at+34,true)/16],
    stageFrame:v.getUint16(at+36,true),character:h[at+38],characters:layout.characters,playerCount:layout.count,...Object.fromEntries(layout.positions.map((xy,i)=>['p'+(i+1),xy])),
    input:v.getUint16(at+22,true),p2Power:h[at+72],p2Level:h[at+73],players,invincible:!!h[at+p.invincible],
    targets:layout.players.map((_,i)=>v.getUint16(at+p.target_counts+i*2,true)),
    core:'DOSBox-X JSPI',executionThread:'worker',stage:h[d+0x576e],turbo:!!h[d+0x5776],
    slowFrames:v.getUint32(d+0x1ec2,true),totalFrames:v.getUint32(d+0x1ec6,true),activeBullets:active,clouds,
    heapBytes:h.length,frames,render:mod.framePresenter,audioPackets,audioEnergy,paused,nativePaused:nativeStatus().paused,bombActive:!!h[d+0x4206],rank:h[d+0x576f],
    ...(qaEnabled?{itemPickups:layout.players.map((_,i)=>v.getUint32(at-patch.mailbox_cs_offset+patch.items.pickup_counts+i*4,true))}:{})};
}
function publish(){if(fatal||exited||!ci)return;scan();if(nativeStatus().exit){exitSession();return;}inputs();if(musicReader&&(soloMode||mailbox>=0)){if(!soloMode&&musicReader.at<0){const v=new DataView(mod.HEAPU8.buffer),segment=v.getUint16(guestBase+0x60*4+2,true);musicReader.at=guestBase+segment*16+musicReader.patch.mailbox_com_offset;}const events=musicReader.read(mod.HEAPU8);if(events.length)send('music',{events});}if(statePending)return;const s=state();if(s){statePending=true;send('state',{state:s});}}
const config=(cycles,core)=>`[dosbox]\nmachine=pc98\nmemsize=16\n[cpu]\ncore=${core}\ncputype=386\ncycles=${cycles}\n[render]\nframeskip=0\nscaler=none\naspect=false\n[sblaster]\nsbtype=none\n[pc98]\npc-98 fm board=board86\n[mixer]\nrate=44100\nblocksize=512\nprebuffer=20\n[autoexec]\n@echo off\nmount a /home/web_user/game\na:\ncd KAIKI\nFAST.BAT\n`;
async function boot(data){
  soloMode=!!data.solo;
  const dependency=name=>import(new URL(name,data.base).href);
  const [locator,{writeNativeTouch,nativeHitPoints},{NativeMusic},players,{createPersonalHud,compositePersonalHudRgb},solo,art]=await Promise.all([
    dependency('game-locator.js'),dependency('native-touch.js'),dependency('solo-native-music.js'),dependency('native-players.js'),dependency('personal-hud.js'),
    soloMode?dependency('solo-input.js'):null,soloMode?null:dependency('afterimage-art.js'),
  ]);
  gameLocator=locator.createGameLocator();if(solo)soloInput=new solo.SoloInput(data.patch);
  nativeTouch=soloMode?null:writeNativeTouch;musicReader=data.musicPatch?new NativeMusic(data.musicPatch):null;
  nativeLayout=players.nativePlayers;patch=data.patch;qaEnabled=!!data.qa;const dispatch=onmessage,vendor=new URL('vendor/dosbox-x/',data.base);
  viewSlot=data.viewSlot||0;
  const compiledTask=data.compiledCore?Promise.resolve(data.compiledCore):(async()=>{
    const [{loadCompiledCore},response]=await Promise.all([
      import(new URL('startup-assets.js',data.base).href),fetch(new URL('runtime.json',vendor),{cache:'no-store'})]);
    if(!response.ok)throw Error('模拟器核心清单读取失败');
    const manifest=await response.json();
    return loadCompiledCore(new URL('wdosbox-x-fast.wasm',vendor),manifest.files['wdosbox-x-fast.wasm']);
  })();
  const afterimageTask=art?art.loadAfterimageArt(patch):Promise.resolve(null);
  compiledTask.catch(()=>{});afterimageTask.catch(()=>{});
  importScripts(new URL('sidebar-background.js',data.base).href,new URL('frame-presenter.js',data.base).href,new URL('emulators.js',vendor).href,new URL('wdosbox-x-jspi.js',vendor).href);onmessage=dispatch;
  const compiledCore=await compiledTask;
  const init=[...data.files,{dosboxConf:config(data.cycles||'max 100%',data.core||'simple'),jsdosConf:{version:'8'}}];
  const sessionId='th05-fast-'+Date.now(),queue=[];let receiver;
  const audioPort={postMessage:(message,transfer)=>{if(message instanceof Float32Array){audioPackets++;for(let i=0;i<message.length;i+=32)audioEnergy+=Math.abs(message[i]);}data.audioPort.postMessage(message,transfer||[]);}};
  mod={canvas:data.canvas,audioPort,instantiateWasm:(imports,receive)=>receive(new WebAssembly.Instance(compiledCore,imports),compiledCore),locateFile:file=>new URL(file==='wdosbox-x-jspi.wasm'?'wdosbox-x-fast.wasm':file,vendor).href,
    postMessage:(name,props)=>{if(receiver)receiver(name,props);else queue.push([name,props]);}};
  const transport={sessionId,module:mod,net:null,sendMessageToServer:(name,props)=>mod.messageHandler({data:{name,props}}),
    initMessageHandler:handler=>{receiver=handler;for(const [name,props]of queue)handler(name,props);queue.length=0;},exit:()=>{}};
  await WDOSBOXXJSPI(mod);mod.callMain([sessionId]);
  ci=await emulators.backend(init,transport,{});
  if(!soloMode){
    mod.afterimageArt=await art.installAfterimageArt(mod,patch,await afterimageTask);
  }
  presentationActive=data.presentationActive!==false;
  mod.getSidebarBackground=()=>{
    if(mailbox<0)return null;
    const d=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
    return sidebarBackground(mod.HEAPU8.subarray(d+0x264a,d+0x267a));
  };
  mod.getHitPoints=()=>soloMode?soloInput.markers(mod.HEAPU8):nativeStatus().paused?[]:nativeHitPoints(mod.HEAPU8,mailbox,patch,input.touch||[0,0]);
  mod.getPersonalHud=createPersonalHud(()=>mailbox<0||nativeStatus().paused?null:{heap:mod.HEAPU8,mailbox,patch},()=>viewSlot);
  mod.onFrameRendered=(frame,width,height,seq)=>{
    if(frameProofHolding)return; // QA: retain the exact verified image until resume.
    if(!presentationActive||frameTransfers.size>=4){mod.framePresenter.backpressureDropped++;return;}
    const proof=frameProof;frameProof=null;
    const rgb=proof?mod.HEAPU8.slice(frame,frame+width*height*3):null;
    const bitmap=mod.canvas.transferToImageBitmap();
    frameTransfers.add(seq);mod.framePresenter.transferred++;
    postMessage({type:'frame',bitmap,seq,width,height,producedAt:performance.timeOrigin+performance.now()},[bitmap]);
    if(proof){
      frameProofHolding=true;paused=true;ci.pause();
      const raw=rgb.slice(),background=mod.sidebarBlack,changed=normalizeSidebarRgb(rgb,width,height,background);
      if(width===640&&height===400)compositePersonalHudRgb(rgb,mod.getPersonalHud());
      import(new URL('netplay/sha256.js',data.base||self.location.href).href).then(({sha256})=>Promise.all([sha256(rgb),sha256(raw)]))
        .then(([hash,rawHash])=>send('qa-result',{id:proof.id,state:state(),proof:{seq,width,height,sha256:hash,rawSha256:rawHash,sidebarBlack:background,normalizedPixels:changed}})).catch(emitError);
    }
  };
  const presentation=data.presentation==='bitmap'?'bitmap':qaEnabled&&data.presentation==='upstream'?'upstream':'direct';
  mod.framePresenter=installFramePresenter(mod,presentation);
  ci.events().onMessage((type,...args)=>{logs.push({type,message:args.join(' ')});logs=logs.slice(-30);if(type==='error'&&args.some(x=>String(x).includes('[panic]')))emitError(args.join(' '));});
  ci.events().onExit(exitSession);
  ci.events().onFrame(()=>frames++);
  ci.events().onSoundPush(samples=>{audioPackets++;if(audioPackets<500)for(let i=0;i<samples.length;i+=16)audioEnergy+=Math.abs(samples[i]);});
  // This upstream counter counts dirty framebuffer updates, not screen scanout.
  // Actual adapter submissions/draws are recorded separately in framePresenter.
  setInterval(()=>{frames=mod.messageFrame||frames;publish();},16);
  send('ready');
}
onmessage=async({data})=>{try{
  if(data.type==='boot'){await boot(data);return;}
  if(data.type==='ack'){statePending=false;return;}
  if(data.type==='frame-ack'){frameTransfers.delete(data.seq);return;}
  if(data.type==='view-slot'&&Number.isInteger(data.slot)&&data.slot>=0&&data.slot<3){viewSlot=data.slot;mod.framePresenter?.flush();return;}
  if(data.type==='presentation-active'){presentationActive=!!data.value;return;}
  if(data.type==='input'){
    if(soloMode){soloInput.write(mod.HEAPU8,data.input,paused);return;}
    input=data.input;if(input.p2&16){p2Pulse|=16;p2PulseTick=nativeInputTick();}if(input.p3&16){p3Pulse|=16;p3PulseTick=nativeInputTick();}inputs();nativeTouch?.(mod?.HEAPU8,mailbox,patch,input.touch||[0,0],paused||nativeStatus().paused);return;
  }
  if(data.type==='key'){
    // A short touch tap can be cleared before the next native player update.
    // Keep gameplay Bomb pressed until the guest has had one actual update.
    // Menu confirm must be releasable while the native player tick is frozen.
    if(data.code===88&&((soloMode&&soloInput?.snapshot?.mode===1)||(!soloMode&&mailbox>=0&&!state()?.players.every(p=>p.ghost)))){
      if(data.down){keyPressTicks.set(data.code,nativeInputTick());deferredKeyUps.delete(data.code);}
      else if(keyPressTicks.get(data.code)===nativeInputTick()){deferredKeyUps.add(data.code);return;}
      else keyPressTicks.delete(data.code);
    }
    ci?.sendKeyEvent(data.code,data.down);return;
  }
  if(data.type==='pause'){paused=true;soloInput?.clear(mod.HEAPU8);p2Pulse=p3Pulse=0;for(const code of deferredKeyUps)ci.sendKeyEvent(code,false);deferredKeyUps.clear();keyPressTicks.clear();input={p2:0,slow:0,invincible:input.invincible};inputs();ci.pause();return;}
  if(data.type==='resume'){frameProofHolding=false;paused=false;ci.resume();return;}
  if(data.type==='game-pause'&&ci&&!exited){if(data.onlyPause&&nativeStatus().paused)return;ci.sendKeyEvent(256,true);setTimeout(()=>{if(!exited)ci.sendKeyEvent(256,false);},110);return;}
  if(data.type==='capture'&&mod){
    const previous=mod.updateTexture;
    mod.updateTexture=(...args)=>{previous(...args);mod.updateTexture=previous;mod.canvas.convertToBlob({type:'image/png'}).then(blob=>send('capture',{id:data.id,blob})).catch(emitError);};return;
  }
  if(data.type==='qa'&&qaEnabled&&data.enabled&&mailbox>=0){
    if(data.action==='frame-proof'){
      if(mod.framePresenter.mode!=='bitmap'||paused||frameProof)throw Error('画面验证需要运行中的完整帧呈现');
      frameProof={id:data.id};return;
    }
    const wasPaused=paused;
    if(['setup','stage','turbo','power','item','inspect'].includes(data.action)){
      ci.pause();await new Promise(resolve=>setTimeout(resolve,40));
      // Fixtures must edit the canonical P1/P2/P3 layout, including the
      // inactive guest bank between two native callbacks.
      const canonical=()=>mod.HEAPU8[mailbox+90]===0&&mod.HEAPU8[mailbox-patch.mailbox_cs_offset+patch.entry_map.guest_slot]===1;
      for(let attempt=0;!canonical()&&attempt<100;attempt++){
        ci.resume();await new Promise(resolve=>setTimeout(resolve,8));ci.pause();await new Promise(resolve=>setTimeout(resolve,24));
      }
      if(!canonical())throw Error('QA 等待玩家状态还原超时');
    }
    const h=mod.HEAPU8,v=new DataView(h.buffer),d=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
    const layout=nativeLayout(h,mailbox,patch);
    if(data.action==='stage'){const resident=guestBase+v.getUint16(d+0x41fe,true)*16+v.getUint16(d+0x41fc,true);h[resident+0x13]=data.stage;h[d+0x576c]=2;}
    if(data.action==='turbo')h[d+0x5776]=data.value?1:0;
if(data.action==='power')for(let i=0;i<layout.count;i++){
      const base=layout.states[i];h[base+32]=128;h[base+33]=9;
      v.setUint16(layout.shots[i],v.getUint16(d+0x1d70+layout.characters[i]*20+18,true),true);
    }
    if(data.action==='setup'||data.action==='item'){
      const c=data.config,m=mailbox,w=(at,x)=>v.setUint16(at,x,true),b=(at,x)=>h[at]=x,wordAt=at=>v.getUint16(at,true);
      if(c.clear){h.fill(0,d+0x5f2a,d+0x912a);b(d+0x3f97,0);b(d+0x3f96,0);}
      if(c.stocks)for(let i=0;i<layout.count;i++)if(c.stocks[i]){
        const [l,bomb,pow]=c.stocks[i];b(layout.stocks[i],l);b(layout.stocks[i]+1,bomb);b(layout.states[i]+32,pow);
      }
      if(c.positions)for(let i=0;i<layout.count;i++)if(c.positions[i]){
        const base=layout.states[i];for(const off of [2,6,22,26]){w(base+off,c.positions[i][0]*16);w(base+off+2,c.positions[i][1]*16);}
      }
      if(c.bullet!==undefined){
        const base=layout.states[c.bullet],at=d+0x5f2a;b(base+30,0);b(base+31,0);b(at,1);b(at+1,3);
        w(at+2,wordAt(base+2));w(at+4,wordAt(base+4));w(at+6,wordAt(at+2));w(at+8,wordAt(at+4));w(at+10,0);w(at+12,0);b(at+18,1);b(at+19,2);
      }
      if(c.allOut)for(let i=0;i<layout.count;i++){b(layout.stocks[i],1);b(layout.states[i]+30,0);b(layout.states[i]+35,1);}
      if(c.stage){const resident=guestBase+wordAt(d+0x41fe)*16+wordAt(d+0x41fc);b(resident+0x13,c.stage-1);b(d+0x576c,2);}
      if(data.action==='item'){
        if(!Number.isInteger(c.seat)||c.seat<0||c.seat>=layout.count||!Number.isInteger(c.kind)||c.kind<0||c.kind>6)throw Error('Invalid QA item fixture');
        h.fill(0,d+0xb084,d+0xb084+40*20);b(d+0x1e84,0);
        for(let i=0;i<layout.count;i++){
          const base=layout.states[i],pow=h[base+32];let level=0;
          while(level<9&&pow>=wordAt(d+0x18ac+level*2))level++;
          b(base+33,level);w(layout.shots[i],wordAt(d+0x1d70+layout.characters[i]*20+level*2));w(layout.overflows[i],0);
          b(base+36,0);b(base+30,192);b(base+31,0);b(m+patch.mailbox_offsets.out_flags+i,c.ghosts?.[i]?1:0);b(m+patch.mailbox_offsets.rescue_progress+i,0);
        }
        const at=d+0xb084,base=layout.states[c.seat];b(at,1);w(at+2,wordAt(base+2));w(at+4,wordAt(base+4));w(at+6,wordAt(base+2));w(at+8,wordAt(base+4));b(at+14,c.kind);w(at+16,36+c.kind);
      }
    }
    const cs=mailbox-patch.mailbox_cs_offset,word=at=>v.getUint16(at,true);
    const inspection={state:state(),rank:h[d+0x576f],stage:h[d+0x576e],characters:layout.characters,
      artVariants:Array.from(h.slice(cs+patch.entry_map.art_variants,cs+patch.entry_map.art_variants+layout.count)),
      nativePositions:layout.states.slice(0,layout.count).map(at=>[v.getInt16(at+2,true)/16,v.getInt16(at+4,true)/16]),
      playerTimers:Array.from(h.slice(d+0x36ee,d+0x36f4)),activePlayer:h[mailbox+90],guestSlot:h[cs+patch.entry_map.guest_slot],
      nativeInput:word(d+0x3064),nativeFocus:h[d+0x3066],miss:h[d+0x36f4],
      speed:layout.states.slice(0,layout.count).map(at=>word(at+14)),bomb:h[d+0x4206],bombFrame:h[d+0x4207],patternCount:word(d+0x6de),
      shotTable:layout.shots.slice(0,layout.count).map(at=>word(at+2)),playerPattern:word(d+0x268c),shotPattern:word(d+0x268c+40),bombFunction:word(d+0x4208),
      playerPatterns:[word(d+0x268c),word(cs+patch.entry_map.guest_patterns),word(cs+patch.entry_map.p3_patterns)],
      shotPatterns:[word(d+0x268c+40),word(cs+patch.entry_map.guest_patterns+12),word(cs+patch.entry_map.p3_patterns+12)],
      bombAssets:[word(d+0x420a),word(cs+patch.entry_map.p3_bb-2),word(cs+patch.entry_map.p3_bb)],
      assetHeap:{top:word(d+0x2684),head:word(d+0x2686),freeList:word(d+0x2688),bottom:word(d+0x268a),contiguousFreeBytes:(word(d+0x2686)-word(d+0x268a))*16},
      itemActive:Array.from({length:40},(_,i)=>h[d+0xb084+i*20]).filter(Boolean).length,
      powerLevel:layout.states.slice(0,layout.count).map(at=>h[at+33]),powerFunction:layout.shots.slice(0,layout.count).map(word),
      expectedPowerFunction:layout.players.map((_,i)=>word(d+0x1d70+layout.characters[i]*20+h[layout.states[i]+33]*2))};
    if(!wasPaused&&['setup','stage','turbo','power','item','inspect'].includes(data.action))ci.resume();
    const metrics=data.action==='metrics'?await ci.asyncifyStats():null;
    send('qa-result',{id:data.id,state:state(),inspection,logs,metrics});return;
  }
}catch(e){emitError(e);}};
