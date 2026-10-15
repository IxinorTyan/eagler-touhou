import {DOSBoxPC98} from '../dosbox-adapter.js';
import {sha256} from './sha256.js';
import {readCoopState,coopInputOffset} from '../coop.js';
import {TOUCH_BOMB,readHitRecovery} from '../touch-input.js';
import {createPresentationLimiter} from '../performance-mode.js';
import {NativeMusic,NetplayMusic} from './local-music.js';

const signature=new TextEncoder().encode('TH01ORB-LAB-v03!');
const keyTable=[['ArrowLeft',37,1],['ArrowRight',39,2],['KeyZ',90,4],['KeyX',88,8],
  ['ArrowUp',38,16],['ArrowDown',40,32],['Enter',13,64],['Escape',27,128]];
export class GameRuntime{
  constructor(canvas,hostSlot){
    this.canvas=canvas;this.hostSlot=hostSlot;this.frame=0;this.bridge=-1;
    this.candidates=[];this.history=new Map();this.pending=[0,0];this.previous=[0,0];this.oldKeys=0;
    this.menuHolds=Array(8).fill(0);this.rawKeys=0;
    this.presentation=createPresentationLimiter();this.scanCursor=0;this.staleFrames=0;
    this.nativeMusic=new NativeMusic();this.musicEvents=[];this.musicStatus='独立音乐：准备中';this.musicVolume=.7;this.stopped=false;
  }
  async load(settings,progress){
    this.settings={players:2,lifeCompensation:true,...settings};settings=this.settings;
    this.pending=Array(settings.players).fill(0);this.previous=Array(settings.players).fill(0);
    progress('加载并校验游戏和联机运行时…');
    const get=async path=>{const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error(`资源读取失败：${path}`);return r;};
    const meta=await (await get('th01-multiorb.json')).json();
    this.touchStateOffsets=meta.touch_state;
    const version=await (await get('netplay/runtime.json')).json();
    let wasmBinary;
    for(const [name,hash] of Object.entries(version.files)){
      const bytes=new Uint8Array(await (await get(name)).arrayBuffer());
      if(await sha256(bytes)!==hash)throw Error(`运行时校验失败：${name}`);
      if(name==='vendor/dosbox-x/wdosbox-x-rollback.wasm')wasmBinary=bytes;
    }
    const compressed=await get(meta.url);
    const disk=new Uint8Array(await new Response(compressed.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    if(disk.length!==meta.size||await sha256(disk)!==meta.sha256)throw Error('游戏磁盘校验失败');
    disk[meta.configuration['REIIDEN/REIIDEN.CFG'].offset+7]=settings.rank;
    disk[meta.configuration['REIIDEN/ORBS.CFG'].offset]=48+settings.count;
    disk[meta.configuration['REIIDEN/COOP.CFG'].offset]=48+settings.players;
    disk[meta.configuration['REIIDEN/MUSIC.CFG'].offset]=49;
    const startConfig=meta.configuration['REIIDEN/START.CFG'];
    if(!startConfig)throw Error('游戏镜像需要更新，缺少直接开局配置');
    disk[startConfig.offset]=49;
    const lifeConfig=meta.configuration['REIIDEN/LIVES.CFG'];
    if(!lifeConfig)throw Error('游戏镜像需要更新，缺少生命补偿配置');
    disk[lifeConfig.offset]=settings.lifeCompensation?49:48;
    progress('初始化固定时钟模拟器…');
    this.emulator=await DOSBoxPC98.create({canvas:this.canvas,lockstep:true,lockstepEpoch:version.epoch,wasmBinary,
      onError:error=>this.onFailure?.(error),onExit:()=>this.onFailure?.(Error('模拟器已退出'))});
    this.emulator.addDiskImage('th01.hdi',disk);await this.emulator.setHdd(0,'th01.hdi');
    this.emulator.module.shouldPresentFrame=()=>{
      const state=this.state(false);
      if(state&&[1,2].includes(state.phase)&&this.view().getUint16(this.bridge+144,true)!==0)return false;
      return this.presentation.allow(performance.now(),this.frame);
    };
    this.fingerprint=await sha256(new TextEncoder().encode(JSON.stringify({version,disk:meta.sha256,settings,
      selectedWasm:this.emulator.module.mobileRuntime})));
    return this.fingerprint;
  }
  view(){const buffer=this.emulator.module.HEAPU8.buffer;if(this.cachedView?.buffer!==buffer)this.cachedView=new DataView(buffer);return this.cachedView;}
  valid(at){
    const h=this.emulator.module.HEAPU8,v=this.view();
    return at>=0&&at+236<=h.length&&signature.every((b,i)=>h[at+i]===b)&&
      v.getUint16(at+16,true)===3&&v.getUint16(at+18,true)<=3&&
      v.getUint16(at+24,true)>=1&&v.getUint16(at+24,true)<=20&&
      [2,3].includes(v.getUint16(at+180,true))&&v.getUint16(at+218,true)>0;
  }
  findBridge(){
    const h=this.emulator.module.HEAPU8,v=this.view();
    // Reuse an advancing bridge. Menus and transitions may leave stale copies;
    // then resume bounded scans rather than walking the full heap each half second.
    if(this.valid(this.bridge)){
      const ticks=v.getUint32(this.bridge+20,true),before=this.history.get(this.bridge);
      this.history.set(this.bridge,ticks);
      this.staleFrames=before===ticks?this.staleFrames+1:0;
      if(this.staleFrames<30)return;
    }
    if(this.frame%(this.valid(this.bridge)?6:2)===0){
      if(this.scanCursor>=h.length)this.scanCursor=0;
      const end=Math.min(this.scanCursor+1024*1024,h.length),slice=h.subarray(this.scanCursor,Math.min(end+signature.length,h.length));
      for(let offset=slice.indexOf(84);offset>=0&&this.scanCursor+offset<end;offset=slice.indexOf(84,offset+1)){
        const at=this.scanCursor+offset;if(this.valid(at)&&!this.candidates.includes(at))this.candidates.push(at);
      }
      this.scanCursor=end;this.candidates=this.candidates.filter(at=>this.valid(at));
      for(const at of this.history.keys())if(!this.candidates.includes(at)&&at!==this.bridge)this.history.delete(at);
    }
    const advancing=[];
    for(const at of this.candidates){
      if(!this.valid(at))continue;
      const ticks=v.getUint32(at+20,true),before=this.history.get(at);
      if(before!==undefined&&ticks!==before)advancing.push(at);
      this.history.set(at,ticks);
    }
    if(!advancing.includes(this.bridge)&&advancing.length===1)this.bridge=advancing[0];
    if(!this.valid(this.bridge))this.bridge=-1;
  }
  state(detail=true){
    if(!this.emulator||!this.valid(this.bridge))return null;
    const v=this.view(),b=this.bridge,count=v.getUint16(b+26,true);
    const state={phase:v.getUint16(b+18,true),stage:v.getUint16(b+24,true),count,
      recovering:readHitRecovery(v,b,this.touchStateOffsets),
      ticks:v.getUint32(b+20,true),samples:v.getUint32(b+214,true),
      coopMenu:v.getUint16(b+210,true)};
    if(detail){state.players=readCoopState(v,b);state.balls=Array.from({length:count},(_,i)=>({x:v.getInt16(b+44+i*12,true),y:v.getInt16(b+46+i*12,true)}));}
    return state;
  }
  guestBase(){
    if(!this.valid(this.bridge))return -1;
    const v=this.view(),b=this.bridge;
    const base=b-v.getUint16(b+218,true)*16-v.getUint16(b+220,true);
    if(base<0||base+0xa0000>this.emulator.module.HEAPU8.length)throw Error('游戏内存布局无效');
    return base;
  }
  start(){this.emulator.run();}
  present(){return this.emulator.module.netPresent();}
  setPresentationMode(mode){this.presentation.setMode(mode);}
  stop(){this.stopped=true;this.music?.dispose();this.musicEvents=[];this.emulator?.module.netFlushAudio();this.emulator?.pause();}
  setMusicVolume(value){this.musicVolume=value;this.music?.setVolume(value);}
  async unlockAudio(){
    this.ensureMusic();await Promise.all([this.emulator?.module.SDL2?.audioContext?.resume(),this.music?.context.resume()]);
  }
  ensureMusic(){
    if(this.stopped||this.music)return;
    const context=this.emulator?.module.SDL2?.audioContext;if(!context)return;
    this.music=new NetplayMusic(context,text=>{this.musicStatus=text;this.onMusicStatus?.(text);});this.music.setVolume(this.musicVolume);
    this.music.load().catch(e=>{if(!this.stopped){this.musicStatus=`音乐错误：${e.message}`;this.onMusicStatus?.(this.musicStatus);}});
    for(const event of this.musicEvents.splice(0))this.music.command(event);
  }
  applyKeys(bits){
    for(const [code,keyCode,bit] of keyTable){
      if((bits&bit)===(this.oldKeys&bit))continue;
      this.emulator.module.netKey(bits&bit?'keydown':'keyup',{code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code,
        keyCode,which:keyCode,charCode:0,location:0,timeStamp:this.frame*1000/60,
        shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,repeat:false,preventDefault(){}});
    }
    this.oldKeys=bits;
  }
  step(inputs){
    const m=this.emulator.module;
    this.findBridge();
    const state=this.state(false),playing=state&&[1,2].includes(state.phase),host=inputs[this.hostSlot];
    // Only the room host operates native title/route/score/Continue menus.
    const raw=playing?(inputs.reduce((a,b)=>a|b,0)&128):((host&255)|(inputs.reduce((a,b)=>a|b,0)&128));
    let nativeBits=raw;
    for(let i=0;i<keyTable.length;i++){
      const bit=keyTable[i][2];
      if(playing&&bit!==128)this.menuHolds[i]=0;
      else if((raw&bit)&&!(this.rawKeys&bit))this.menuHolds[i]=4;
      if(this.menuHolds[i]>0){nativeBits|=bit;this.menuHolds[i]--;}
    }
    this.applyKeys(nativeBits);this.rawKeys=raw;
    if(state){
      const v=this.view(),b=this.bridge;
      for(let i=0;i<inputs.length;i++){
        const buttons=(inputs[i]&15)|((inputs[i]&TOUCH_BOMB)?16:0);
        const previous=(this.previous[i]&15)|((this.previous[i]&TOUCH_BOMB)?16:0);
        if(playing)this.pending[i]|=(buttons&~previous)&28;
        else this.pending[i]=0;
        v.setUint16(b+coopInputOffset(i),playing?(buttons|this.pending[i]):0,true);
      }
      if((host&256)&&!(this.previous[this.hostSlot]&256)&&state.coopMenu===3)v.setUint16(b+212,1,true);
      if(this.settings.qa){
        const edges=host&~this.previous[this.hostSlot];
        if(edges&(1536|8192))v.setUint16(b+140,v.getUint16(b+140,true)|((edges&512?2:0)|(edges&1024?4:0)|(edges&8192?8:0)),true);
        if((edges&2048)&&playing){v.setUint16(b+30,state.stage,true);v.setUint16(b+28,(v.getUint16(b+32,true)+1)&65535,true);}
      }
    }
    m.netBeginFrame(this.frame,false);
    try{this.emulator.step();}finally{m.netEndFrame();}
    m.netConfirm(this.frame+1);
    // The BGM reader never writes guest state or gates the next simulation tick.
    this.ensureMusic();
    if(!this.musicReaderFailed)try{
      for(const event of this.nativeMusic.read(m.HEAPU8)){
        if(this.music)this.music.command(event);else{this.musicEvents.push(event);if(this.musicEvents.length>64)this.musicEvents.shift();}
      }
    }catch(error){
      this.musicReaderFailed=true;this.musicStatus=`音乐事件读取失败：${error.message}`;this.onMusicStatus?.(this.musicStatus);
    }
    const after=this.state(false);
    if(after&&state&&(after.samples!==state.samples||after.stage!==state.stage))this.pending.fill(0);
    this.previous=inputs.slice();this.frame++;
  }
  checksum(){
    let h=0x811c9dc5;
    const mix=n=>{h=Math.imul(h^n,0x01000193);};
    for(const value of [this.frame,this.oldKeys,this.rawKeys,...this.menuHolds,...this.pending,...this.previous])mix(value);
    const base=this.guestBase();
    if(base>=0){
      const heap=this.emulator.module.HEAPU8;
      // All conventional RAM: DOS, stage data, players, orbs, RNG and action timers.
      for(let at=base;at<base+0xa0000;at++)mix(heap[at]);
    }
    return {type:'hash',frame:this.frame,hash:(h>>>0).toString(16).padStart(8,'0'),memory:base>=0};
  }
}
