// Browser host adapter. Nothing here is stored in guest RAM or a DOS file.
// Experimental: observe host clock reads as well as inputs, preserving max cycles.
export const HOST_VERSION='th05-external-jspi/2';
export const CLOCK_BYTES=9, CLOCK_CHUNK=4096;
const RealDate=Date,realNow=()=>performance.now();
export function createExternalReplayHost({mode,clocks,events=[],endBoundary,onChunk,onEnd,onError,onRecordingError=onError,applyInput,observe,inspect,maxClockBytes=512*1024*1024}){
  if(!['record','playback'].includes(mode))throw Error('无效的外部 replay 模式');
  let mod,boundary=0,count=0,eventCursor=0,queued=[],buffer=new Uint8Array(CLOCK_BYTES*CLOCK_CHUNK),used=0;
  let stopped=false,ending=false,held=false,wake=null,timer=null,observerMs=0,clockMs=0,lastWake=0,epoch,recording=mode==='record',finished=false;
  const source=clocks?new DataView(clocks.buffer,clocks.byteOffset,clocks.byteLength):null;
  const started=realNow();
  function disable(error){if(!recording)return;recording=false;ending=false;used=0;try{onRecordingError?.(error);}catch{}}
  function chunk(value){try{onChunk(value);}catch(error){disable(error);}}
  function flush(){if(!used)return;const bytes=buffer.slice(0,used);used=0;chunk({clocks:bytes});}
  function time(kind){
    const at=realNow();let value;
    if(mode==='record'){
      value=kind===1?performance.now():RealDate.now();
      if(recording){
        if((count+1)*CLOCK_BYTES>maxClockBytes)disable(Error('录像时钟超过容量，游戏继续'));
        else{const view=new DataView(buffer.buffer);view.setUint8(used,kind);view.setFloat64(used+1,value,true);used+=CLOCK_BYTES;
          if(used===buffer.length)flush();}
      }
    }else{
      const offset=count*CLOCK_BYTES;
      if(offset+CLOCK_BYTES>source.byteLength||source.getUint8(offset)!==kind)throw Error(`Replay 时钟失步：读取 ${count}，边界 ${boundary}`);
      value=source.getFloat64(offset+1,true);
      if(!Number.isFinite(value)||value<0)throw Error('Replay 时钟值无效');
    }
    if(kind===2&&epoch===undefined)epoch=value;
    if(mode==='playback'||recording)count++;clockMs+=realNow()-at;return value;
  }
  function HostDate(...args){
    if(!new.target)return new RealDate(time(2)).toString();
    return Reflect.construct(RealDate,args.length?args:[time(2)],new.target);
  }
  Object.setPrototypeOf(HostDate,RealDate);HostDate.prototype=RealDate.prototype;HostDate.now=()=>time(2);
  const hostPerformance=new Proxy(performance,{get(target,name){if(name==='now')return ()=>time(1);const value=Reflect.get(target,name,target);return typeof value==='function'?value.bind(target):value;}});
  function finish(){
    if(finished||stopped||mode==='record'&&!recording)return;finished=true;ending=false;
    if(mode==='playback')stopped=true;
    flush();
    if(mode==='record'&&!recording)return;
    recording=false;
    if(mode==='playback'&&(count*CLOCK_BYTES!==source.byteLength||eventCursor!==events.length))throw Error('Replay 结束时仍有未消费的记录');
    const result={boundary,clockCount:count,elapsedMs:realNow()-started,observerMs,clockMs};
    // inspect copies the guest bytes synchronously at this boundary. Hashing,
    // compression and the save dialog must never hold the player's continuation.
    const inspected=inspect?.();
    Promise.resolve(inspected).then(extra=>onEnd({...result,...extra})).catch(mode==='record'?onRecordingError:onError);
  }
  function resume(){
    if(stopped||held||!wake)return;
    clearTimeout(timer);
    try{
      const at=realNow();
      if(mode==='record'){
        const batch=queued;queued=[];
        for(const command of batch)applyInput(command);
        if(recording&&batch.length)chunk({events:[{boundary,commands:batch}]});
      }else{
        if(events[eventCursor]?.boundary<boundary)throw Error('Replay 输入边界失步');
        while(events[eventCursor]?.boundary===boundary)for(const command of events[eventCursor++].commands)applyInput(command);
      }
      try{if(observe?.(boundary)===true&&recording)ending=true;}catch(error){if(mode==='playback')throw error;disable(error);}
      observerMs+=realNow()-at;
      if(ending||(mode==='playback'&&boundary===endBoundary)){finish();if(mode==='playback')return;}
      if(mode==='playback'&&boundary>endBoundary)throw Error('Replay 超出结束边界');
      const next=wake;wake=null;next();
    }catch(error){stopped=true;onError(error);}
  }
  function initialize(){
    mod.alive=true;mod.sleep_count=mod.nonskippable_sleep_count=mod.sleep_time=0;
    lastWake=time(2);mod.last_wakeup=lastWake;mod.sync_sleep=()=>{};
    mod.destroyAsyncify=()=>{stopped=true;clearTimeout(timer);mod.alive=false;};
    mod.uncaughtAsyncify=onError;return 1;
  }
  return {
    Date:HostDate,performance:hostPerformance,
    keyTime:()=>time(2)-epoch,
    attach(module,imports){
      mod=module;
      for(const namespace of Object.values(imports)){
        if(namespace.initMessageSyncSleep)namespace.initMessageSyncSleep=initialize;
        if(namespace.initTimeoutSyncSleep)namespace.initTimeoutSyncSleep=initialize;
        if(namespace.__asyncjs__syncSleep)namespace.__asyncjs__syncSleep=new WebAssembly.Suspending(async(ms,nonSkippable)=>{
          const now=time(2);if(!nonSkippable&&now-lastWake<24)return;
          mod.sleep_count++;if(nonSkippable)mod.nonskippable_sleep_count++;
          await new Promise(resolve=>{boundary++;wake=resolve;timer=setTimeout(resume,nonSkippable?Math.max(0,ms):0);});
          lastWake=now;mod.last_wakeup=now;
        });
      }
    },
    queue(command){if(mode!=='record'||stopped)return;queued.push(structuredClone(command));},
    finish(){if(mode!=='record'||stopped||!recording)return;ending=true;if(wake)resume();},
    disable(){recording=false;ending=false;used=0;},
    pause(value){held=!!value;if(!held&&wake)timer=setTimeout(resume,0);},
    get boundary(){return boundary;},
    get status(){return {mode,boundary,clockCount:count,observerMs,clockMs,stopped,held,recording,finished};},
  };
}
