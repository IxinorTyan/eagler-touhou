import {applyStage,stageSelection} from '../stage-select.js';
import {sha256} from './sha256.js';
import {PROTOCOL} from './queue.js';
import {LocalAudio} from './audio.js';

// The transport and immutable input queue come from the older multiorb lab.
// Only this adapter knows about the native C++ core; it never runs its own clock.
export class GameRuntime{
  constructor(canvas,hostSlot){
    this.canvas=canvas;this.hostSlot=hostSlot;this.frame=0;this.previous=[];
    this.context=canvas?.getContext('2d',{alpha:false});
    this.image=null;this.presentRequest=null;
    this.audio=new LocalAudio();this.audio.onStatus=text=>this.onMusicStatus?.(text);
  }
  async load(settings,progress=()=>{}){
    this.settings={...settings};progress('加载并校验原生游戏与联机版本…');
    const get=async path=>{const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error(`资源读取失败：${path}`);return r;};
    const version=await (await get('netplay/runtime.json')).json();
    if(version.protocol!==PROTOCOL||version.tickNumerator!==440000||version.tickDenominator!==24830)throw Error('联机版本不匹配，请刷新页面');
    let binary;
    await Promise.all(Object.entries(version.files).map(async([name,hash])=>{
      const bytes=new Uint8Array(await (await get(name)).arrayBuffer());
      if(await sha256(bytes)!==hash)throw Error(`联机资源校验失败：${name}`);
      if(name==='game.wasm')binary=bytes;
    }));
    if(!binary)throw Error('联机清单缺少游戏核心');
    const module=await WebAssembly.compile(binary);
    if(WebAssembly.Module.imports(module).length)throw Error('游戏核心含外部导入');
    this.core=(await WebAssembly.instantiate(module,{})).exports;
    if(!this.core.th_net_checksum||!this.core.th_set_netplay_rules||this.core.memory.buffer.byteLength!==4194304)throw Error('游戏核心需要更新');
    // The core has fixed memory. Share its RGBA view instead of copying 1 MiB
    // into a second ImageData buffer for every displayed frame.
    if(this.context)this.image=new ImageData(new Uint8ClampedArray(this.core.memory.buffer,this.core.th_pixels(),640*400*4),640,400);
    // Each room starts with the same records. Device-local scores must never
    // enter synchronized menus or change registration eligibility on one peer.
    this.core.th_score_data();this.scoreRevision=this.core.th_get(110,0);
    this.reset();this.present();
    return sha256(new TextEncoder().encode(JSON.stringify({version,settings,hostSlot:this.hostSlot})));
  }
  reset(){
    const s=this.settings,e=this.core;
    e.th_init(s.players,s.count,0x12345678,s.lifeCompensation?1:0);
    e.th_set_netplay_rules(1);e.th_set_difficulty(s.rank);applyStage(e,s.startStage);
  }
  start(){this.stopped=false;}
  state(){
    if(!this.core)return null;const e=this.core,g=(n,p=0)=>e.th_get(n,p);
    return {phase:g(0),stage:g(27),route:g(69),count:g(4),menu:g(50),cursor:g(51),timer:g(16),
      entrance:g(117),bossPhase:g(60),bombActive:!!g(14),score:g(2),rank:g(42),
      players:Array.from({length:g(3)},(_,p)=>({left:g(30,p),lives:g(31,p),bombs:g(32,p),ghost:!!g(33,p),invincibility:g(34,p),rescues:g(35,p)})),
      balls:Array.from({length:g(4)},(_,p)=>({x:g(20,p),y:g(21,p)}))};
  }
  step(inputs){
    const e=this.core,g=(f,p=0)=>e.th_get(f,p),host=inputs[this.hostSlot],edges=inputs.map((v,i)=>v&~(this.previous[i]||0)),edge=edges[this.hostSlot];
    const menu=g(50);let handled=false;
    // Any player may request pause. Only the room owner controls menus,
    // including route choice, continue, ending skip and name registration.
    if(!menu&&edges.some(v=>v&128)){
      e.th_menu_open(3,this.settings.lifeCompensation?1:0);handled=true;
    }else if(menu){
      let key=edge&16?0:edge&32?1:edge&1?2:edge&2?3:edge&64?(menu===12?6:4):edge&4?4:edge&(8|128)?5:-1;
      if((edge&256)&&menu===9){e.th_menu_input(0);key=4;}
      if(key>=0){
        const action=e.th_menu_input(key);
        if(action===1)this.reset();
        // Quit exits to the in-game title, rather than closing one peer's tab.
        if(action===3)e.th_menu_open(1,this.settings.lifeCompensation?1:0);
        handled=true;
      }
    }else if(g(0)===2&&(edge&(4|64))){e.th_continue();handled=true;}
    if(this.settings.qa&&!menu){
      if(edge&16384)e.th_debug_invincible(!g(43));
      for(let p=0;p<inputs.length;p++)if(edge&[512,1024,8192][p])e.th_debug_hit(p,1);
      if(edge&2048){
        if(g(60)>=0)e.th_stage_command(20,0,g(61),0,0,0);
        else e.th_stage_command(15,0,0,0,0,0);
      }
    }
    if(!handled)e.th_step(...[0,1,2].map(i=>(inputs[i]||0)&15|((inputs[i]||0)&4096?16:0)));
    this.previous=inputs.slice();this.frame++;
    const revision=g(110);
    if(revision!==this.scoreRevision){
      this.scoreRevision=revision;
      if(!stageSelection(this.settings.startStage).practice)try{const data=new Uint8Array(e.memory.buffer,e.th_score_data(),e.th_score_size());
        localStorage.setItem('th01-native-net-scores-v1',btoa(String.fromCharCode(...data)));}
      catch{this.scoreSaveError=true;}
    }
    this.audio.update(e);
  }
  checksum(){
    let h=this.core.th_net_checksum();
    for(const n of [this.frame,...this.previous])for(let b=0;b<4;b++)h=Math.imul(h^((n>>>(8*b))&255),16777619);
    return {type:'hash',frame:this.frame,hash:(h>>>0).toString(16).padStart(8,'0'),memory:true};
  }
  present(){
    if(!this.core||!this.context||this.stopped||this.presentedFrame===this.frame)return;
    this.core.th_render();
    this.context.putImageData(this.image,0,0);this.presentedFrame=this.frame;
  }
  requestPresent(){
    if(!this.context||this.stopped||this.presentRequest!==null||this.presentedFrame===this.frame)return;
    // Network callbacks publish inputs promptly; display only the newest
    // confirmed frame at the next browser repaint, including after catch-up.
    this.presentRequest=requestAnimationFrame(()=>{
      this.presentRequest=null;
      if(document.hidden||this.stopped)return;
      try{this.present();}catch(error){if(this.onFailure)this.onFailure(error);else throw error;}
    });
  }
  unlockAudio(){return this.audio.unlock();}
  setMusicVolume(value){this.audio.setVolume(value);}
  stop(){this.stopped=true;if(this.presentRequest!==null)cancelAnimationFrame(this.presentRequest);this.presentRequest=null;this.audio.stop();}
}
