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
    this.image=null;this.presentRequest=null;this.renderCost=0;this.displayFrames=0;
    this.renderBackend='main';this.renderBusy=false;this.mainRenderCost=0;
    this.audio=new LocalAudio();this.audio.onStatus=text=>this.onMusicStatus?.(text);
  }
  async load(settings,progress=()=>{}){
    this.settings={...settings};progress('加载并校验原生游戏与联机版本…');
    const get=async path=>{const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error(`资源读取失败：${path}`);return r;};
    const version=await (await get('netplay/runtime.json')).json();
    if(version.protocol!==PROTOCOL||version.tickNumerator!==440000||version.tickDenominator!==24830)throw Error('联机版本不匹配，请刷新页面');
    let binary,rendererSource;
    await Promise.all(Object.entries(version.files).map(async([name,hash])=>{
      const bytes=new Uint8Array(await (await get(name)).arrayBuffer());
      if(await sha256(bytes)!==hash)throw Error(`联机资源校验失败：${name}`);
      if(name==='game.wasm')binary=bytes;
      if(name==='netplay/renderer.js')rendererSource=bytes;
    }));
    if(!binary||!rendererSource)throw Error('联机清单缺少游戏核心或绘图线程，请刷新页面');
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
    await this.startRenderer(module,rendererSource);
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
      // Dedicated Continue selects Yes; confirmation remains a separate input.
      if((edge&256)&&menu===9)key=0;
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
  getRenderSnapshotLayout(){
    const e=this.core,heapBytes=e.memory.buffer.byteLength;
    // Unknown/older ABI retains the full-heap path. Version 1 only omits the
    // output explicitly guaranteed by the core to be regenerated by render.
    if(e.th_render_snapshot_info?.(0)!==1)return [0,heapBytes,0,0];
    const offset=e.th_pixels(),bytes=e.th_render_snapshot_info(1);
    if(!Number.isInteger(offset)||offset<0||bytes!==640*400*4||offset+bytes>heapBytes)throw Error('游戏核心绘图快照布局无效');
    return [1,heapBytes,offset,bytes];
  }
  async startRenderer(module,verifiedSource){
    if(!this.context||this.stopped)return false;
    if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined')return false;
    return new Promise(resolve=>{
      let workerURL,settled=false,readyCount=0;
      this.renderWorkers=[];
      const finish=(ready,reason='')=>{
        if(settled)return;settled=true;clearTimeout(timer);this.cancelRendererStart=null;
        if(workerURL)URL.revokeObjectURL(workerURL);
        if(ready&&!this.stopped){
          this.renderBackend='worker';this.renderPending=[];
          this.renderSnapshots=Array.from({length:2},()=>new ArrayBuffer(this.renderSnapshotLayout[1]-this.renderSnapshotLayout[3]));
          resolve(true);
        }else{
          for(const worker of this.renderWorkers)worker.terminate();this.renderWorkers=[];this.renderWorker=null;
          this.rendererFallback=reason;resolve(false);
        }
      };
      const timer=setTimeout(()=>finish(false,'绘图线程启动超时'),5000);
      this.cancelRendererStart=()=>finish(false);
      try{
        this.renderSnapshotLayout=this.getRenderSnapshotLayout();
        const heap=new Uint8Array(this.core.memory.buffer),[,,offset,bytes]=this.renderSnapshotLayout;
        this.renderSourceBefore=heap.subarray(0,offset);this.renderSourceAfter=heap.subarray(offset+bytes);
        // Execute the exact bytes already checked against runtime.json, rather
        // than letting a second Worker fetch reuse an older cached script.
        if(verifiedSource)workerURL=URL.createObjectURL(new Blob([verifiedSource],{type:'text/javascript'}));
        for(let lane=0;lane<2;lane++){
          const worker=new Worker(workerURL||'netplay/renderer.js');this.renderWorkers.push(worker);this.renderWorker=this.renderWorkers[0];
          worker.onmessage=({data})=>{
            if(this.stopped||!this.renderWorkers.includes(worker)){data.bitmap?.close();return;}
            if(!settled){
              if(data.type==='ready'){
                if(!Array.isArray(data.layout)||data.layout.length!==4||!data.layout.every((value,i)=>value===this.renderSnapshotLayout[i])){finish(false,'绘图线程快照布局不匹配');return;}
                if(!worker.renderReady){worker.renderReady=true;if(++readyCount===2)finish(true);}
              }
              else if(data.type==='error')finish(false,data.message);
              return;
            }
            try{
              if(data.type==='error')throw Error(data.message);
              const index=this.renderPending.findIndex(job=>job.worker===worker&&job.frame===data.frame);
              if(data.type!=='frame'||index<0)throw Error('绘图线程返回了无效帧');
              if(!(data.snapshot instanceof ArrayBuffer)||data.snapshot.byteLength!==this.renderSnapshotLayout[1]-this.renderSnapshotLayout[3])throw Error('绘图线程返回了无效快照');
              const [job]=this.renderPending.splice(index,1);this.renderSnapshots.push(data.snapshot);this.renderBusy=this.renderPending.length>0;
              const started=performance.now();
              if(!document.hidden&&(this.presentedFrame===undefined||data.frame>this.presentedFrame)){
                this.context.drawImage(data.bitmap,0,0);this.presentedFrame=data.frame;this.displayFrames++;
              }else if(data.frame===this.renderSubmittedFrame)this.renderSubmittedFrame=null;
              this.recordRenderCost(data.cost+job.snapshotCost,performance.now()-started+job.snapshotCost);
              this.renderLatency=performance.now()-job.started;
              this.requestPresent();
            }catch(error){if(this.onFailure)this.onFailure(error);else throw error;}
            finally{data.bitmap?.close();}
          };
          worker.onerror=event=>{
            event.preventDefault?.();
            if(this.stopped||!this.renderWorkers.includes(worker))return;
            if(!settled)finish(false,event.message||'绘图线程不可用');
            else{const error=Error(event.message||'绘图线程发生错误');if(this.onFailure)this.onFailure(error);else throw error;}
          };
          worker.postMessage({type:'init',module,layout:this.renderSnapshotLayout});
        }
      }catch(error){finish(false,error.message);}
    });
  }
  recordRenderCost(total,main){
    this.renderCost=this.renderCost?this.renderCost*.75+total*.25:total;
    this.mainRenderCost=this.mainRenderCost?this.mainRenderCost*.75+main*.25:main;
  }
  present(){
    if(!this.core||!this.context||this.stopped||this.presentedFrame===this.frame)return;
    const started=performance.now();
    if(this.renderBackend==='worker'){
      if(!this.renderSnapshots.length||this.renderSubmittedFrame===this.frame)return;
      // Two display-only cores use separate CPU threads when a draw overruns
      // one tick. One snapshot per worker bounds both memory and render lag.
      const worker=this.renderWorkers.find(candidate=>!this.renderPending.some(job=>job.worker===candidate));
      if(!worker)return;
      const snapshot=this.renderSnapshots.pop();
      const packed=new Uint8Array(snapshot),offset=this.renderSourceBefore.length;
      if(offset)packed.set(this.renderSourceBefore);packed.set(this.renderSourceAfter,offset);
      this.renderPending.push({frame:this.frame,worker,started,snapshotCost:performance.now()-started});
      this.renderBusy=true;this.renderSubmittedFrame=this.frame;
      worker.postMessage({type:'render',frame:this.frame,snapshot},[snapshot]);return;
    }
    this.core.th_render();this.context.putImageData(this.image,0,0);
    this.presentedFrame=this.frame;this.displayFrames++;
    const cost=performance.now()-started;this.recordRenderCost(cost,cost);
  }
  requestPresent(){
    if(!this.context||this.stopped||document.hidden||this.presentRequest!==null||this.presentedFrame===this.frame)return;
    // Start off-thread drawing as soon as confirmed state is available, rather
    // than waiting for rAF and then missing that same repaint while it renders.
    if(this.renderBackend==='worker'){this.present();return;}
    this.presentRequest=requestAnimationFrame(()=>{
      this.presentRequest=null;
      if(document.hidden||this.stopped)return;
      try{this.present();}catch(error){if(this.onFailure)this.onFailure(error);else throw error;}
    });
  }
  unlockAudio(){return this.audio.unlock();}
  setMusicVolume(value){this.audio.setVolume(value);}
  stop(){this.stopped=true;if(this.presentRequest!==null)cancelAnimationFrame(this.presentRequest);this.presentRequest=null;this.cancelRendererStart?.();for(const worker of this.renderWorkers||[])worker.terminate();this.renderWorkers=[];this.renderWorker=null;this.renderSnapshots=[];this.renderPending=[];this.audio.stop();}
}
