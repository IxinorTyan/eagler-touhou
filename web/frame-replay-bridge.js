// Runs in the browser worker. The guest only emits synchronous marker ports;
// every input byte, checkpoint and file buffer belongs to browser JS memory.
import {FRAME_STRIDE} from './frame-replay-codec.js';
export function createFrameReplayBridge({mod,patch,config,onRun,onChunk,onEnd,onDialog=()=>{},onPhase=()=>{},onTaint=()=>{}}){
  const signature=new TextEncoder().encode(patch.signature);
  let base=-1,data=-1,resident=-1,initial=null,started=false,done=false,frames=0,used=0;
  let pending=null,lastHash=null,lastState=null,dialog=false;
  let phase='battle',battleEnd=null,slowFrames=null;
  let buffer=new Uint8Array(FRAME_STRIDE*1024),checks=[];
  const playback=config.mode==='playback',source=config.inputs,expected=config.header;
  let cheat=false,unlimited=false,tainted=false,recordingStopped=false;
  let touchMailbox=-1,touchLive=false,touchBegin=false,touchUnlimited=false,touchX=0,touchY=0,touchPoints=1,touchGeneration=-1,lastTouchInput=-Infinity;
  const clamp=value=>Math.max(-8192,Math.min(8191,value));
  const totalFrames=playback?source.length/FRAME_STRIDE:0,sourceView=playback?new DataView(source.buffer,source.byteOffset,source.byteLength):null;
  function locate(packed){
    const heap=mod.HEAPU8,ds=packed>>>16,cs=packed&65535;
    if(base>=0){data=base+ds*16;touchMailbox=base+cs*16+patch.mailbox_cs_offset;return;}
    const v=new DataView(heap.buffer);
    for(let at=heap.indexOf(signature[0]);at>=0;at=heap.indexOf(signature[0],at+1)){
      if(!signature.every((b,i)=>heap[at+i]===b)||v.getUint16(at+20,true)!==ds)continue;
      const candidate=at-patch.mailbox_cs_offset-cs*16,d=candidate+ds*16;
      if(candidate<0||candidate+0x100000>heap.length)continue;
      const r=candidate+v.getUint16(d+0x41fe,true)*16+v.getUint16(d+0x41fc,true);
      if(new TextDecoder().decode(heap.subarray(r,r+9))!=='KSOConfig')continue;
      base=candidate;data=d;resident=r;touchMailbox=at;return;
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
      if(!expected.ending||sequence!==expected.ending.sequence||frames!==totalFrames||checksum()!==expected.gameHash)throw Error('Replay 通关战斗终点校验不一致');
    }else commit();
    battleEnd={frames,gameHash:checksum(),initial,checks,state:state()};
    phase='ending';dialog=true;onDialog(true);onPhase({phase,sequence});
  }
  function scoreReady(){
    if(phase!=='ending'||done)return;
    if(tainted||recordingStopped){done=true;onEnd({discarded:true,reason:tainted?'cheat':'storage'});return;}
    const sequence=mod.HEAPU8[resident+26];
    if(slowFrames===null)throw Error('Replay 缺少通关统计提交标记');
    const ending={sequence,endpoint:'score',residentHash:residentHash(),slowFrames};
    if(playback&&sequence!==expected.ending.sequence)throw Error('Replay 结局类型发生变化');
    done=true;phase='completed';dialog=false;onDialog(false);flush();
    onEnd({...battleEnd,ending,...(playback?{matches:ending.residentHash===expected.ending.residentHash}:{} )});
  }
  function flush(){if(!used)return;onChunk(buffer.slice(0,used));used=0;}
  function commit(){if(pending===null)return;buffer.set(pending,used);used+=FRAME_STRIDE;pending=null;if(used===buffer.length)flush();}
  function finish(atBoundary=true){
    if(done||!started)return;done=true;flush();
    if(!atBoundary&&pending!==null){pending=null;frames--;checks=checks.filter(c=>c.frame<frames);}
    const hash=atBoundary?checksum():lastHash;
    onEnd({frames,gameHash:hash,initial,checks,state:atBoundary?state():{...lastState,frames},
      ...(playback?{matches:frames===expected.frames&&hash===expected.gameHash}:{} )});
  }
  function invalidate(){const first=!tainted;tainted=true;pending=null;checks=[];buffer=new Uint8Array(0);used=0;lastHash=lastState=null;battleEnd=null;if(first)onTaint();}
  const api={
    stopRecording(){
      if(playback)return;
      recordingStopped=true;pending=null;checks=[];used=0;buffer=new Uint8Array(0);lastHash=lastState=null;battleEnd=null;
    },
    touchInput(input,paused=false){
      if(playback||touchMailbox<0)return;
      const h=mod.HEAPU8,v=new DataView(h.buffer),at=touchMailbox;
      if(input.generation!==v.getUint16(at+24,true))return;
      lastTouchInput=performance.now();const t=input.touch;touchGeneration=input.generation;touchPoints=(input.points??1)&9;
      if(paused||h[at+22]!==1||h[at+23]||!t?.active){touchLive=false;touchBegin=false;touchX=touchY=0;return;}
      if(t.begin){touchBegin=true;touchX=touchY=0;}
      touchLive=true;touchUnlimited=!!t.unlimited;
      if(touchUnlimited)invalidate();
      touchX=clamp(touchX+(Number.isFinite(t.x)?t.x:0));touchY=clamp(touchY+(Number.isFinite(t.y)?t.y:0));
    },
    setCheat(value){
      if(playback)throw Error('Replay 播放期间不能启用作弊');
      cheat=typeof value==='object'?!!value.invincible:!!value;
      unlimited=typeof value==='object'?!!value.unlimited:false;
      if(cheat||unlimited)invalidate();
    },
    signal(port,packed){
      if(done){
        if(playback||port!==0x7ff0)return;
        // A new MAIN launch starts another independent run in this emulator.
        base=data=resident=touchMailbox=-1;touchLive=false;touchBegin=false;touchX=touchY=0;touchGeneration=-1;initial=null;started=done=dialog=false;frames=used=0;
        pending=lastHash=lastState=null;checks=[];buffer=new Uint8Array(FRAME_STRIDE*1024);
        phase='battle';battleEnd=null;slowFrames=null;
        recordingStopped=false;tainted=cheat||unlimited;buffer=new Uint8Array(tainted?0:FRAME_STRIDE*1024);
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
        if((tainted||recordingStopped)&&started){done=true;onEnd({discarded:true,reason:tainted?'cheat':'storage'});return;}
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
        if(!started&&!playback){tainted=cheat||unlimited;buffer=new Uint8Array(tainted?0:FRAME_STRIDE*1024);}
        resident=base+v.getUint16(data+0x41fe,true)*16+v.getUint16(data+0x41fc,true);
        if(h[resident+0x1f])return; // Native attract demos do not create a run.
        if(playback)h.set(expected.initial,resident);
        initial=Array.from(h.subarray(resident,resident+128));
        return;
      }
      if(!initial||h[resident+0x1f])return;
      if(!started){started=true;onRun({...state(),tainted});}
      const touchAt=base+(packed&65535)*16+patch.mailbox_cs_offset+28;
      if(!playback){
        // Browser messages only queue intent. All native touch writes happen
        // here, at the same boundary as recording, before the guest consumes it.
        const at=touchAt-28;
        h[at+26]=touchPoints;
        if(touchLive&&performance.now()-lastTouchInput<=750&&touchGeneration===v.getUint16(at+24,true)&&h[at+22]===1&&!h[at+23]){
          if(touchBegin)v.setInt32(touchAt+2,0,true);
          v.setUint16(touchAt,touchUnlimited?3:1,true);
          v.setInt16(touchAt+2,clamp(v.getInt16(touchAt+2,true)+touchX),true);v.setInt16(touchAt+4,clamp(v.getInt16(touchAt+4,true)+touchY),true);
        }else{v.setUint16(touchAt,0,true);v.setInt32(touchAt+2,0,true);}
        touchX=touchY=0;touchBegin=false;
      }
      if(!playback&&(v.getUint16(touchAt,true)&2))invalidate();
      if(tainted){
        if(h[data+0x576c]===1){done=true;onEnd({discarded:true,reason:'cheat'});return;}
        // The native player's invulnerability timer is refreshed at the
        // synchronous input boundary. No cheat ever enters a replay file.
        if(cheat)h[data+0x36d0+30]=2;
        return;
      }
      if(recordingStopped){
        if(h[data+0x576c]===1){done=true;onEnd({discarded:true,reason:'storage'});}
        return;
      }
      if(!playback)commit();
      if(h[data+0x576c]===1||(playback&&frames===totalFrames)){
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
        const at=frames*FRAME_STRIDE,mask=source[at];
        if(source[at+1]>1)throw Error('Replay 不允许不限速移动');
        v.setUint16(touchAt,source[at+1],true);v.setInt16(touchAt+2,sourceView.getInt16(at+2,true),true);v.setInt16(touchAt+4,sourceView.getInt16(at+4,true),true);
        v.setUint16(data+0x3064,(mask&63)|(mask&128?0x2000:0),true);h[data+0x3066]=(mask>>>6)&1;
      }else{
        const input=v.getUint16(data+0x3064,true);
        // Commit only after reaching the next input boundary. A stop while
        // inside an unhandled native menu can still export a valid prefix.
        pending=new Uint8Array(FRAME_STRIDE);pending[0]=(input&63)|(h[data+0x3066]?64:0)|(input&0x2000?128:0);
        pending[1]=v.getUint16(touchAt,true)&1;
        if(pending[1])pending.set(h.subarray(touchAt+2,touchAt+6),2);
      }
      frames++;
    },
    finish(){if(!tainted&&!recordingStopped&&started&&phase==='battle'&&frames>1&&!playback)finish(false);},
    get dialog(){return dialog;},get launched(){return initial!==null;},get started(){return started;},get done(){return done;},
    get status(){return {mode:config.mode,frames,started,done,dialog,phase,bytes:tainted||recordingStopped?0:frames*FRAME_STRIDE,clockBytes:0,tainted,cheat,unlimited,recordingStopped};},
  };
  return api;
}
