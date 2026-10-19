// Runs in the browser worker. The guest only emits synchronous marker ports;
// every input byte, checkpoint and file buffer belongs to browser JS memory.
export function createFrameReplayBridge({mod,patch,config,onRun,onChunk,onEnd,onDialog=()=>{},onPhase=()=>{}}){
  const signature=new TextEncoder().encode(patch.signature);
  let base=-1,data=-1,resident=-1,initial=null,started=false,done=false,frames=0,used=0;
  let pending=null,lastHash=null,lastState=null,dialog=false;
  let phase='battle',battleEnd=null,slowFrames=null;
  let buffer=new Uint8Array(4096),checks=[];
  const playback=config.mode==='playback',source=config.inputs,expected=config.header;
  function locate(packed){
    const heap=mod.HEAPU8,ds=packed>>>16,cs=packed&65535;
    if(base>=0){data=base+ds*16;return;}
    const v=new DataView(heap.buffer);
    for(let at=heap.indexOf(signature[0]);at>=0;at=heap.indexOf(signature[0],at+1)){
      if(!signature.every((b,i)=>heap[at+i]===b)||v.getUint16(at+20,true)!==ds)continue;
      const candidate=at-patch.mailbox_cs_offset-cs*16,d=candidate+ds*16;
      if(candidate<0||candidate+0x100000>heap.length)continue;
      const r=candidate+v.getUint16(d+0x41fe,true)*16+v.getUint16(d+0x41fc,true);
      if(new TextDecoder().decode(heap.subarray(r,r+9))!=='KSOConfig')continue;
      base=candidate;data=d;resident=r;return;
    }
    throw Error('无法定位同步 Replay 输入边界');
  }
  function state(){
    const h=mod.HEAPU8,v=new DataView(h.buffer);
    return {frames,stage:h[data+0x576e],character:h[data+0x5773],rank:h[data+0x576f],
      x:v.getInt16(data+0x36d2,true)/16,y:v.getInt16(data+0x36d4,true)/16};
  }
  function checksum(){
    const h=mod.HEAPU8;let hash=2166136261;
    // Selected gameplay state only: RNG, player/resources and stage settings.
    // Native pause timers, keyboard BIOS bytes, audio and rendering are excluded.
    for(const [offset,size]of [[0x418,4],[0x36d0,40],[0x4ad4,4],[0x576e,10]])
      for(let i=data+offset;i<data+offset+size;i++)hash=Math.imul(hash^h[i],16777619);
    return (hash>>>0).toString(16).padStart(8,'0');
  }
  function residentHash(){
    let hash=2166136261;
    for(const byte of mod.HEAPU8.subarray(resident,resident+128))hash=Math.imul(hash^byte,16777619);
    return (hash>>>0).toString(16).padStart(8,'0');
  }
  function beginEnding(sequence){
    if(playback){
      if(!expected.ending||sequence!==expected.ending.sequence||frames!==source.length||checksum()!==expected.gameHash)throw Error('Replay 通关战斗终点校验不一致');
    }else commit();
    battleEnd={frames,gameHash:checksum(),initial,checks,state:state()};
    phase='ending';dialog=true;onDialog(true);onPhase({phase,sequence});
  }
  function scoreReady(){
    if(phase!=='ending'||done)return;
    const sequence=mod.HEAPU8[resident+26];
    if(slowFrames===null)throw Error('Replay 缺少通关统计提交标记');
    const ending={sequence,endpoint:'score',residentHash:residentHash(),slowFrames};
    if(playback&&sequence!==expected.ending.sequence)throw Error('Replay 结局类型发生变化');
    done=true;phase='completed';dialog=false;onDialog(false);flush();
    onEnd({...battleEnd,ending,...(playback?{matches:ending.residentHash===expected.ending.residentHash}:{} )});
  }
  function flush(){if(!used)return;onChunk(buffer.slice(0,used));used=0;}
  function commit(){if(pending===null)return;buffer[used++]=pending;pending=null;if(used===buffer.length)flush();}
  function finish(atBoundary=true){
    if(done||!started)return;done=true;flush();
    if(!atBoundary&&pending!==null){pending=null;frames--;checks=checks.filter(c=>c.frame<frames);}
    const hash=atBoundary?checksum():lastHash;
    onEnd({frames,gameHash:hash,initial,checks,state:atBoundary?state():{...lastState,frames},
      ...(playback?{matches:frames===expected.frames&&hash===expected.gameHash}:{} )});
  }
  return {
    signal(port,packed){
      if(done){
        if(playback||port!==0x7ff0)return;
        // A new MAIN launch starts another independent run in this emulator.
        base=data=resident=-1;initial=null;started=done=dialog=false;frames=used=0;
        pending=lastHash=lastState=null;checks=[];buffer=new Uint8Array(4096);
        phase='battle';battleEnd=null;slowFrames=null;
      }
      // MAINE has its own DS and no MAIN mailbox. Keep the browser's resident
      // pointer across exec; never relocate MAIN from an ending marker.
      if(port===0x7ff5){scoreReady();return;}
      if(port===0x7ff6){
        if(phase==='ending'){
          const view=new DataView(mod.HEAPU8.buffer);
          // Performance is a recorded result, not a battle input. Restore only
          // the native slowdown statistic after battle, before evaluation.
          // Never correct position, lives, RNG, score or gameplay statistics.
          if(playback)view.setUint32(resident+60,expected.ending.slowFrames,true);
          slowFrames=view.getUint32(resident+60,true);
        }
        return;
      }
      if(phase==='ending')return;
      locate(packed);
      const h=mod.HEAPU8,v=new DataView(h.buffer);
      if(port===0x7ff2){
        const sequence=h[resident+26];
        if(started&&[253,254,255].includes(sequence)){beginEnding(sequence);return;}
        if(playback&&expected.ending)throw Error('Replay 提前退出，未进入预期结局');
        finish(false);return;
      }
      if(port===0x7ff3||port===0x7ff4){
        if(!initial)return;
        dialog=port===0x7ff3;onDialog(dialog);return;
      }
      if(port===0x7ff0){
        resident=base+v.getUint16(data+0x41fe,true)*16+v.getUint16(data+0x41fc,true);
        if(h[resident+0x1f])return; // Native attract demos do not create a run.
        if(playback)h.set(expected.initial,resident);
        initial=Array.from(h.subarray(resident,resident+128));
        return;
      }
      if(!initial||h[resident+0x1f])return;
      if(!started){started=true;onRun(state());}
      if(!playback)commit();
      if(h[data+0x576c]===1||(playback&&frames===source.length)){
        if(playback&&expected.ending)throw Error('Replay 输入已用完，但游戏尚未触发通关');
        finish();return;
      }
      lastHash=checksum();lastState=state();
      if(frames%120===0){
        const hash=lastHash;
        if(playback){const check=expected.checks[frames/120];if(check?.frame!==frames||check.hash!==hash)throw Error(`Replay 游戏状态失步：第 ${frames} 帧 (${hash} / ${check?.hash})`);}
        else checks.push({frame:frames,hash});
      }
      if(playback){
        const mask=source[frames];v.setUint16(data+0x3064,(mask&63)|(mask&128?0x2000:0),true);h[data+0x3066]=(mask>>>6)&1;
      }else{
        const input=v.getUint16(data+0x3064,true);
        // Commit only after reaching the next input boundary. A stop while
        // inside an unhandled native menu can still export a valid prefix.
        pending=(input&63)|(h[data+0x3066]?64:0)|(input&0x2000?128:0);
      }
      frames++;
    },
    finish(){if(started&&phase==='battle'&&frames>1&&!playback)finish(false);},
    get dialog(){return dialog;},get launched(){return initial!==null;},get started(){return started;},get done(){return done;},
    get status(){return {mode:config.mode,frames,started,done,dialog,phase,bytes:frames,clockBytes:0};},
  };
}
