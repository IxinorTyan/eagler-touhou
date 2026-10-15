import './vendor/dosbox-x/emulators.js';
import {extractGame,dosboxConfig,NETWORK_CYCLES} from './dosbox-disk.js';
import {LocalAudioOutput} from './netplay/audio-output.js';
import {installFramePresenter} from './frame-presenter.js';
import {dosboxKeyCode} from './dosbox-keys.js';
import {sha256} from './netplay/sha256.js';

export class DOSBoxPC98{
  static async create(config){const emulator=new DOSBoxPC98(config);try{await emulator.initialize();return emulator;}catch(error){emulator.dispose();throw error;}}
  constructor(config){this.config=config;this.state='loading';this.disks=new Map();this.keys=new Set();this.tick=0;this.outputs=new Map();this.frame=null;}
  async initialize(){
    const net=!!this.config.lockstep;
    if(!net&&(typeof WebAssembly.Suspending!=='function'||typeof WebAssembly.promising!=='function'))throw Error('DOSBox-X 需要支持 WebAssembly JSPI 的新版 Chrome / Edge。');
    const context=new AudioContext({sampleRate:44100,latencyHint:'interactive'});
    context.resume().catch(()=>{});this.audio=new LocalAudioOutput(context,1);
    const vendor=new URL('./vendor/dosbox-x/',import.meta.url),emulator=this;
    const runtime=await (await fetch(new URL('runtime.json',vendor),{cache:'no-cache'})).json();
    const wasm=net?'wdosbox-x-rollback.wasm':'wdosbox-x-fast.wasm';
    const wasmBinary=this.config.wasmBinary||new Uint8Array(await (await fetch(new URL(wasm,vendor))).arrayBuffer());
    if(await sha256(wasmBinary)!==runtime.files[wasm])throw Error('DOSBox-X 内核校验失败');
    const epoch=this.config.lockstepEpoch??946684800000,NativeDate=globalThis.Date;
    class VirtualDate extends NativeDate{
      constructor(...args){super(...(args.length?args:[epoch+(emulator.module?.virtualNow||0)]));}
      static now(){return epoch+(emulator.module?.virtualNow||0);}
      getTimezoneOffset(){return 0;}getFullYear(){return this.getUTCFullYear();}getMonth(){return this.getUTCMonth();}
      getDate(){return this.getUTCDate();}getDay(){return this.getUTCDay();}getHours(){return this.getUTCHours();}
      getMinutes(){return this.getUTCMinutes();}getSeconds(){return this.getUTCSeconds();}
    }
    const queue=[];let receiver;
    const m=this.module={canvas:this.config.canvas,wasmBinary,SDL2:{audioContext:context},
      virtualDate:VirtualDate,virtualNow:0,targetNow:0,deterministic:net,
      nativeScheduling:true,nativeCpu:true,nativePlanar:net,nativeFramePresentation:false,
      mobileRuntime:{core:'dosbox-x',cpuCore:'simple',continuation:net?'Asyncify':'JSPI',cycles:net?(this.config.cycles??NETWORK_CYCLES):'auto',idleFusion:false},
      locateFile:f=>new URL(f.endsWith('.wasm')?wasm:f,vendor).href,
      postMessage:(name,props)=>{if(receiver)receiver(name,props);else queue.push([name,props]);},
      onAbort:error=>{this.failure=Error(String(error));this.state='failed';this.config.onError?.(this.failure);}};
    m.installFramePresenter=()=>{
      m.framePresenter?.dispose();
      m.framePresenter=installFramePresenter(m,{deferred:net,isReplaying:()=>false});
    };
    this.transport={sessionId:'th01-dosbox',module:m,net:null,
      sendMessageToServer:(name,props)=>m.messageHandler({data:{name,props}}),
      initMessageHandler:handler=>{receiver=handler;for(const [name,props] of queue)handler(name,props);queue.length=0;},exit:()=>{}};
    const factory=(await import(net?'./vendor/dosbox-x/dosbox-rollback.mjs?th01=3':'./vendor/dosbox-x/dosbox-jspi.mjs?th01=3')).default;
    await factory(m);m.callMain([this.transport.sessionId]);
    this.onSleep=({data})=>{if(!net&&data?.name==='ws-sync-sleep'&&data.props.sessionId===this.transport.sessionId)globalThis.postMessage({name:'wc-sync-sleep',props:data.props},'*');};
    if(!net)window.addEventListener('message',this.onSleep);
    this.onKey=event=>this.key(event.code,event.type==='keydown');
    for(const type of ['keydown','keyup'])this.config.canvas.addEventListener(type,this.onKey);
    m.netKey=(type,event)=>this.key(event.code,type==='keydown');
    m.netBeginFrame=frame=>{this.frame=frame;this.outputs.set(frame,[]);};
    m.netEndFrame=()=>{this.frame=null;};
    m.netConfirm=prefix=>{for(const [frame,blocks] of this.outputs)if(frame<prefix){for(const samples of blocks)this.audio.push([samples]);this.outputs.delete(frame);}};
    m.netFlushAudio=()=>this.audio.flush();m.netInfo=()=>({tick:this.tick,now:m.virtualNow,...this.audio.info()});
    m.netPresent=()=>m.shouldPresentFrame?.()===false?false:m.framePresenter?.flush()||false;
    this.state='ready';
  }
  key(code,down){const number=dosboxKeyCode(code);if(number===undefined)return;if(down)this.keys.add(code);else this.keys.delete(code);if(this.config.lockstep)this.ci?.addKey(number,down,this.module.virtualNow);else this.ci?.sendKeyEvent(number,down);}
  addDiskImage(name,bytes){this.disks.set(name,new Uint8Array(bytes));}
  async setHdd(drive,name){
    if(drive!==0||!this.disks.has(name))throw Error('无效游戏磁盘');
    this.diskName=name;this.extracted=extractGame(this.disks.get(name));
    this.ci=await globalThis.emulators.backend([...this.extracted.files,{dosboxConf:dosboxConfig({network:!!this.config.lockstep,cycles:this.config.cycles}),jsdosConf:{version:'8'}}],this.transport,{});
    this.ci.events().onSoundPush(samples=>{if(this.frame!==null)this.outputs.get(this.frame)?.push(samples.slice());else this.audio.push([samples]);});
    this.logs=[];this.ci.events().onMessage((type,...messages)=>{this.logs.push([type,...messages]);if(this.logs.length>40)this.logs.shift();if(type==='error'&&messages.some(s=>/\[panic\]|Backend crashed|Aborted\(/i.test(String(s)))){this.failure=Error(messages.join(' '));this.state='failed';this.config.onError?.(this.failure);}});
    this.ci.events().onExit(()=>{this.state='exited';this.config.onExit?.();});
    if(!this.config.lockstep)this.ci.pause();
    this.module.SDL2={audioContext:this.audio.context};
    if(!this.module.framePresenter)throw Error('DOSBox-X 画面呈现器未初始化');
    for(const code of this.keys)this.key(code,true);
  }
  run(){if(this.failure)throw this.failure;this.state='running';if(!this.config.lockstep)this.ci.resume();this.audio.context.resume().catch(()=>{});}
  pause(){if(this.state!=='failed')this.state='paused';if(!this.config.lockstep)this.ci?.pause();this.audio?.flush();}
  step(){
    if(!this.config.lockstep||this.state!=='running')throw Error('DOSBox-X 没有进入同步运行状态');
    if(this.failure)throw this.failure;
    const m=this.module;this.tick++;m.cooperativeYields=0;m.targetNow=Math.max(m.virtualNow,Math.floor(this.tick*1000/60));
    let safety=0;
    while(m.wakeAt<=m.targetNow){if(++safety>4096)throw Error('DOSBox-X 同步步骤未让出执行');if(m.wakeAt>m.virtualNow)m.virtualNow=m.wakeAt;m.advanceNative();}
    m.virtualNow=m.targetNow;
    if(!m.pendingWake)throw Error('DOSBox-X 未在同步边界挂起');
  }
  dispose(){this.pause();this.ci?.exit();this.module?.framePresenter?.dispose();this.audio?.disconnect();this.audio?.context.close().catch(()=>{});for(const type of ['keydown','keyup'])this.config.canvas.removeEventListener(type,this.onKey);window.removeEventListener('message',this.onSleep);}
}
