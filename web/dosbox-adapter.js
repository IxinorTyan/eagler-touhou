import './vendor/dosbox-x/emulators.js';
import {extractGame,dosboxConfig,prepareFastBoot} from './dosbox-disk.js';
import {LocalAudioOutput} from './netplay/audio-output.js';
import {createDosboxSnapshots} from './dosbox-snapshots.js';
import {makeMemoryDiff} from './dosbox-memory-diff.js';
import {installFramePresenter} from './frame-presenter.js';
const codes={ArrowUp:265,ArrowDown:264,ArrowLeft:263,ArrowRight:262,KeyZ:90,KeyX:88,ShiftLeft:340,ShiftRight:344,Escape:256,Enter:257,Space:32};
export class DOSBoxPC98 {
  static async create(config){const emulator=new DOSBoxPC98(config);await emulator.initialize();return emulator;}
  constructor(config){this.config=config;this.state='loading';this.disks=new Map();this.keys=new Set();this.outputs=new Map();this.frame=null;this.replaying=false;this.tick=0;this.audioChunks=[];}
  async initialize(){
    const net=!!this.config.lockstep;
    if(!net&&(typeof WebAssembly.Suspending!=='function'||typeof WebAssembly.promising!=='function'))throw Error('DOSBox-X 性能版需要支持 JSPI 的新版 Chrome / Edge。');
    const context=(this.config.audioContext?.state!=='closed'&&this.config.audioContext)||new AudioContext({sampleRate:44100,latencyHint:'interactive'});
    context.resume().catch(()=>{});this.audio=new LocalAudioOutput(context,1);
    const vendor=new URL('./vendor/dosbox-x/',import.meta.url),emulator=this;
    const epoch=this.config.lockstepEpoch??946684800000;
    const NativeDate=globalThis.Date;
    class VirtualDate extends NativeDate {constructor(...args){super(...(args.length?args:[epoch+(emulator.module?.virtualNow||0)]));}static now(){return epoch+(emulator.module?.virtualNow||0);}getTimezoneOffset(){return 0;}getFullYear(){return this.getUTCFullYear();}getMonth(){return this.getUTCMonth();}getDate(){return this.getUTCDate();}getDay(){return this.getUTCDay();}getHours(){return this.getUTCHours();}getMinutes(){return this.getUTCMinutes();}getSeconds(){return this.getUTCSeconds();}}
    const queue=[];let receiver;
    this.module={canvas:this.config.canvas,worker:!!this.config.workerRuntime,SDL2:{audioContext:context},virtualDate:VirtualDate,virtualNow:0,targetNow:0,deterministic:net,
      mobileRuntime:{core:'dosbox-x',cpuCore:'simple',continuation:net?'Asyncify':'JSPI'},
      locateFile:f=>new URL(f==='wdosbox-x-jspi.wasm'?(net?'wdosbox-x-rollback.wasm':'wdosbox-x-fast.wasm'):f==='wdosbox-x.wasm'?'wdosbox-x-rollback.wasm':f,vendor).href,
      postMessage:(name,props)=>{if(receiver)receiver(name,props);else queue.push([name,props]);},
      onAbort:error=>{this.state='failed';this.config.onError?.(Error(String(error)));}};
    this.module.installFramePresenter=()=>{
      this.module.framePresenter?.dispose();
      this.module.framePresenter=installFramePresenter(this.module,{deferred:net,isReplaying:()=>this.replaying});
    };
    this.transport={sessionId:'th04-dosbox',module:this.module,net:null,
      sendMessageToServer:(name,props)=>this.module.messageHandler({data:{name,props}}),
      initMessageHandler:handler=>{receiver=handler;for(const [name,props]of queue)handler(name,props);queue.length=0;},exit:()=>{}};
    const factory=(await import(net?'./vendor/dosbox-x/dosbox-rollback.mjs':'./vendor/dosbox-x/dosbox-jspi.mjs')).default;
    await factory(this.module);this.module.callMain([this.transport.sessionId]);
    if(net&&this.config.rollbackEnabled!==false)this.module.memoryDiff=await makeMemoryDiff(this.module);
    this.onSleep=({data})=>{if(!net&&data?.name==='ws-sync-sleep'&&data.props.sessionId===this.transport.sessionId)globalThis.postMessage({name:'wc-sync-sleep',props:data.props},'*');};
    if(!net&&typeof window!=='undefined'&&window.postMessage)window.addEventListener('message',this.onSleep);
    this.onKey=event=>this.key(event.code,event.type==='keydown');
    for(const type of ['keydown','keyup'])this.config.canvas.addEventListener?.(type,this.onKey);
    this.state='ready';
    const m=this.module;
    m.netKey=(type,event)=>this.key(event.code,type==='keydown');
    m.netBeginFrame=(frame,replay)=>{this.frame=frame;this.replaying=!!replay;this.outputs.set(frame,[]);};
    m.netEndFrame=()=>{this.snapshots?.seal();this.frame=null;this.replaying=false;};
    m.netConfirm=prefix=>{this.snapshots?.confirm(prefix);for(const [frame,blocks]of this.outputs)if(frame<prefix){for(const samples of blocks)this.audio.push([samples]);this.outputs.delete(frame);}};
    m.netCapture=frame=>{if(!this.snapshots)this.snapshots=createDosboxSnapshots(this);this.snapshots.capture(frame);};
    m.netRestore=frame=>{this.snapshots.restore(frame);for(const key of this.outputs.keys())if(key>=frame)this.outputs.delete(key);};
    m.netSnapshotInfo=()=>this.snapshots?.info()||{snapshotBytes:0,snapshots:0};
    m.netFlushAudio=()=>this.audio.flush();m.netInfo=()=>({tick:this.tick,...this.audio.info()});
    m.netPresent=()=>m.framePresenter?.flush({redraw:true})||false;
  }
  key(code,down){const number=codes[code];if(number===undefined)return;if(down)this.keys.add(code);else this.keys.delete(code);if(this.config.lockstep)this.ci?.addKey(number,down,this.module.virtualNow);else this.ci?.sendKeyEvent(number,down);}
  addDiskImage(name,bytes){this.disks.set(name,new Uint8Array(bytes));}
  async setHdd(drive,name){
    if(drive!==0||!this.disks.has(name))throw Error('无效游戏磁盘');this.diskName=name;
    this.extracted=extractGame(this.disks.get(name));
    const network=!!this.config.lockstep,launcher=prepareFastBoot(this.extracted,{network});
    const init=[...this.extracted.files,launcher,{dosboxConf:dosboxConfig({network,fastBoot:true}),jsdosConf:{version:'8'}}];
    this.ci=await globalThis.emulators.backend(init,this.transport,{});
    this.ci.events().onSoundPush(samples=>{this.module.audioPackets=(this.module.audioPackets||0)+1;if(this.module.warmingBoot)return;if(this.config.workerRuntime){this.audioChunks.push(samples.slice());return;}if(this.frame!==null)this.outputs.get(this.frame)?.push(samples.slice());else this.audio.push([samples]);});
    this.logs=[];this.ci.events().onMessage((type,...messages)=>{this.logs.push([type,...messages]);this.logs=this.logs.slice(-40);if(type==='error'&&messages.some(s=>String(s).includes('[panic]'))){this.state='failed';this.config.onError?.(Error(messages.join(' ')));}});
    this.ci.events().onExit(()=>{if(this.resetting)return;this.state='exited';this.config.onExit?.();});
    for(const code of this.keys)this.ci.sendKeyEvent(codes[code],true);
    if(this.state!=='running'&&!this.config.lockstep)this.ci.pause();
    this.module.SDL2={audioContext:this.audio.context};
    if(!this.module.framePresenter)throw Error('DOSBox-X 直接呈现器未初始化，请刷新页面并检查运行资源版本');
  }
  getDiskImage(name){if(name===this.diskName&&this.extracted)return this.extracted.export(this.module.FS);const disk=this.disks.get(name);if(!disk)throw Error('未知磁盘');return disk.slice();}
  run(){this.state='running';if(!this.config.lockstep)this.ci?.resume();this.audio.context.resume().catch(()=>{});}
  pause(){this.state='paused';if(!this.config.lockstep)this.ci?.pause();this.module?.framePresenter?.resetTiming();this.audio.flush();}
  async reset(){
    const running=this.state==='running',diskName=this.diskName,disks=this.disks;
    this.resetting=true;this.pause();
    if(this.ci){const exiting=this.ci.exit();if(this.config.lockstep){for(let i=0;!this.ci.exited&&i<1000;i++){this.module.virtualNow=Math.max(this.module.virtualNow,this.module.wakeAt);this.module.advanceNative();}}await exiting;}
    this.dispose();this.state='loading';this.keys=new Set();this.outputs=new Map();this.frame=null;this.replaying=false;this.tick=0;this.audioChunks=[];this.snapshots=null;
    await this.initialize();this.disks=disks;
    if(diskName)await this.setHdd(0,diskName);
    this.resetting=false;if(running)this.run();
  }
  step(){
    if(!this.config.lockstep||this.state!=='running')throw Error('DOSBox-X 没有进入同步运行状态');
    const m=this.module;this.tick++;m.targetNow=Math.max(m.virtualNow,Math.floor(this.tick*1000/60));
    let safety=0;
    while(m.wakeAt<=m.targetNow){if(++safety>1000)throw Error('DOSBox-X 同步步骤未让出执行');if(m.wakeAt>m.virtualNow)m.virtualNow=m.wakeAt;m.advanceNative();}
    m.virtualNow=m.targetNow;
    if(!m.pendingWake)throw Error('DOSBox-X 未在同步边界挂起');
  }
  readAudio(){if(!this.audioChunks.length)return null;const length=this.audioChunks.reduce((n,s)=>n+s.length,0),samples=new Float32Array(length);let at=0;for(const block of this.audioChunks.splice(0)){samples.set(block,at);at+=block.length;}return [samples];}
  dispose(){this.pause();this.ci?.exit();this.module?.framePresenter?.dispose();this.audio.disconnect();this.audio.context.close().catch(()=>{});for(const type of ['keydown','keyup'])this.config.canvas.removeEventListener?.(type,this.onKey);if(typeof window!=='undefined')window.removeEventListener('message',this.onSleep);}
}
// Source imports keep their legacy class name, while every new instance uses DOSBox-X.
export {DOSBoxPC98 as NP21};
