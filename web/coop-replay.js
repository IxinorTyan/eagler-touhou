import {ConfirmedHistory,historySessionId} from './netplay/confirmed-history.js';
import {receiveNetworkHistory,fetchNetworkCheckpoint} from './netplay/history-network.js';
import {createFrameDisplay} from './frame-display.js';
import {LocalSfx} from './netplay/local-sfx.js';
import {LocalBgm} from './netplay/local-bgm.js';
const $=id=>document.getElementById(id),TICK_MS=1000/60;
let source=null,worker=null,display=null,channel=null,context=null,audio=null,music=null;
let cursor=0,epoch=0,pending=false,paused=false,ready=false,completed=false,timer=0,lastProof=null,live=false,bootstrapped=false,receiving=false;
let viewError=null,musicState=[],target=null,goalKind=null,arrivalPaused=false,following=false,quiet=false,ackFrame=null,nativeExited=false,nextDue=0;
let wakeSerial=0,networkReceiver=null,pendingEnd=0,sliceStart=0,lastSliceUi=0;
let sliceStats={count:0,steps:0,maxSteps:0,maxMs:0,totalMs:0};
let stageSession=null,stageFallback=null;
let stageOptions='';
let checkpointIndex=[],checkpointUsed=null,checkpointLoading=false,checkpointAbort=null,checkpointRequest=0;
const checkpointCache=new Map(),checkpointWaiters=new Map();
function nearestCheckpoint(frame){return [...(source?.checkpoints.index()||[]),...checkpointIndex].filter(e=>e.frame>0&&e.frame<=frame).sort((a,b)=>b.frame-a.frame)[0]||null;}
async function checkpointBytes(entry){
  const local=source?.checkpoints.entries.find(e=>e.frame===entry.frame)||checkpointCache.get(entry.frame);if(local)return local;
  let result;
  if(watch)result=await fetchNetworkCheckpoint(watch,entry,{signal:checkpointAbort.signal,onProgress:(n,total)=>status(`正在下载浏览器检查点 ${entry.frame}：${Math.floor(n/total*100)}%`)});
  else if(channel){
    const request=++checkpointRequest;
    result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{checkpointWaiters.delete(request);reject(Error('检查点接收超时'));},20000);
      checkpointWaiters.set(request,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      channel.postMessage({type:'checkpoint-get',viewer:localViewer,frame:entry.frame,request});
    });
  }else throw Error('检查点来源已关闭');
  if(result.sha!==entry.sha||result.bytes?.length!==entry.size)throw Error('检查点来源身份无效');
  const {sha256}=await import('./netplay/sha256.js');if(await sha256(result.bytes)!==entry.sha)throw Error('检查点传输摘要不一致');
  // Cache only the common base and latest requested point; files own their archive.
  if(entry.frame!==0)for(const frame of checkpointCache.keys())if(frame!==0)checkpointCache.delete(frame);
  checkpointCache.set(entry.frame,result);return result;
}
let localViewer=null;
const wake=new MessageChannel();wake.port1.onmessage=({data})=>{if(data===wakeSerial)pump();};
const status=text=>{$('status').textContent=text;};
const edge=()=>source?.end?source.frames:Math.max(0,(source?.frames||0)-90);
function update(){
  const stages=(source?.stages.segments||[]).filter(s=>s.stage>=1&&s.stage<=5);
  for(const entry of [...(source?.checkpoints.index()||[]),...checkpointIndex])if(entry.stage>=1&&entry.stage<=5&&!stages.some(s=>s.stage===entry.stage))stages.push({first:entry.frame-1,stage:entry.stage});
  stages.sort((a,b)=>a.first-b.first);const signature=stages.map(s=>`${s.first}:${s.stage}`).join(',');
  if(signature!==stageOptions){
    stageOptions=signature;$('stage-select').replaceChildren(new Option('选择一面…',''),...stages.map(s=>new Option(`第 ${s.stage+1} 面 · 帧 ${s.first}`,String(s.first+1))));
  }
  $('stage-select').disabled=!stages.length;
  const points=[...(source?.checkpoints.index()||[]),...checkpointIndex].filter((e,i,a)=>a.findIndex(x=>x.frame===e.frame)===i);
  $('checkpoint-status').textContent=source?`浏览器检查点：${points.filter(e=>e.frame>0).length} 个${checkpointLoading?' · 正在恢复':checkpointUsed!==null?` · 本次从帧 ${checkpointUsed} 恢复`:''}；尚未生成检查点的区间仍需逐帧执行。`:'';
  $('cheat-warning').hidden=!source?.tainted;
  $('play').disabled=!source||!!worker;$('pause').disabled=!worker||completed;$('stop').disabled=!worker&&!receiving;
  $('pause').textContent=paused?'继续播放':'暂停播放';
  $('timeline').max=source?.frames||0;$('timeline').value=cursor;$('timeline').disabled=!source;
  $('seek-frame').max=source?.frames||0;$('seek').disabled=!source;$('cancel-seek').disabled=target===null;
  $('live-edge').disabled=!source||!live||!!source.end;
  $('progress').textContent=source?`已播放 ${cursor} / 已收到 ${source.frames} 同步帧${target!==null?` · 正在${goalKind==='live'?'追赶':'定位'}到 ${target}`:following?` · 跟随直播，落后 ${Math.max(0,edge()-cursor)} 帧`:''}`:'';
  $('diagnostics').textContent=JSON.stringify({cursor,received:source?.frames,paused,ready,completed,pending,target,goalKind,following,lastProof,checkpointUsed,checkpoints:points,stage:stageSession?{stage:stageSession.stage+1,event:stageSession.event,queued:stageSession.sent-stageSession.event,waiting:stageSession.waiting}:null,stageFallback,error:viewError,endpoint:source?.end},null,2);
}
function clearSchedule(){clearTimeout(timer);wakeSerial++;}
function stopCore(preserveSound=false){
  checkpointAbort?.abort();checkpointAbort=null;checkpointLoading=false;
  for(const waiter of checkpointWaiters.values())waiter.reject(Error('检查点读取已取消'));checkpointWaiters.clear();
  epoch++;clearSchedule();worker?.terminate();worker=null;display?.stop();display=null;
  if(preserveSound){
    audio?.resetTimeline();music?.stop();if(music)music.pendingCommands=[];context?.suspend();
  }else{
    audio?.disconnect();audio=null;music?.dispose();music=null;context?.close().catch(()=>{});context=null;
  }
  ready=pending=paused=false;musicState=[];target=goalKind=ackFrame=null;quiet=following=nativeExited=false;update();
  stageSession=null;
}
function stop(){
  if(receiving&&source&&!source.end)source.finish('观看者停止接收，保留已收到片段');
  receiving=false;if(channel&&localViewer)channel.postMessage({type:'unsubscribe',viewer:localViewer});channel?.close();channel=null;networkReceiver?.close();networkReceiver=null;stopCore();$('completed').close();update();
}
function fail(error){viewError=error.message;stop();status('旁观停止：'+error.message);update();}
function acceptMusic(events){
  for(const [ax,hash]of events){
    if((ax>>>8)<=1)musicState=[];musicState.push([ax,hash]);if(musicState.length>64)musicState.splice(1,1);
    if(!quiet&&target===null)music?.command(ax,hash);
  }
}
function restoreMusic(){if(music){music.stop();for(const [ax,hash]of musicState)music.command(ax,hash);}}
async function enableSound(){
  if(!worker)return;
  if(!context){
    const current=epoch;context=new AudioContext({sampleRate:44100});context.suspend();
    audio=new LocalSfx(context);music=new LocalBgm(context,()=>{});restoreMusic();
    try{await Promise.all([audio.load(),music.load({warmOpening:false})]);}
    catch(error){if(current!==epoch)return;throw error;}
    if(current!==epoch)return;
  }
  if(ready&&!paused&&!completed&&target===null&&!quiet)await context.resume();
  else await context.suspend();
}
function schedule(delay=TICK_MS){
  clearSchedule();if(!ready||pending||paused||completed)return;
  if(delay<=0)wake.port2.postMessage(wakeSerial);else timer=setTimeout(pump,delay);
}
function present(){if(ready)worker?.postMessage({type:'history-present'});}
function finish(){
  if(completed)return;completed=true;pending=false;target=goalKind=null;following=false;clearSchedule();context?.suspend();present();
  status(stageSession?'本段分面旁观已到达可验证边界。':'本段旁观已结束 · 逐帧校验一致。');
  $('end-summary').textContent=stageSession?`从第 ${stageSession.stage+1} 面重建，已校验 ${stageSession.event} 条原生事件。画面停在最后完整执行边界；剩余 ${stageSession.sent-stageSession.event} 条事件不足以完成下一步。`: `已播放 ${cursor} 个已确认同步帧，输入、原生计数和状态检查一致。停在这里是正常结束。这是已接收旁观历史的终点，不代表游戏通关。`;
  $('completed').showModal();update();
}
function settleGoal(){
  if(target===null||cursor!==target)return false;
  const kind=goalKind;target=goalKind=null;paused=arrivalPaused;following=kind==='live'&&!source.end;quiet=false;
  present();restoreMusic();if(!paused&&!completed)context?.resume();nextDue=performance.now();
  status(paused?'定位完成 · 观看保持暂停。':following?'已到达追赶目标，继续跟随已确认帧。':'定位完成 · 继续播放。');update();return true;
}
function stageBatch(limit){
  const s=stageSession,events=[];
  while(s.sync<limit&&events.length<128){
    const row=source.stages.frames(s.sync,1)[0];
    if(!row)throw Error('分面历史已过期或中断');
    while(s.at<row.length&&events.length<128){s.locations.set(s.sent+events.length,s.sync+1);events.push(row[s.at++]);}
    if(s.at===row.length){s.sync++;s.at=0;}
  }
  s.sent+=events.length;return events;
}
function stageRecover(error){
  const frame=target??cursor,kind=goalKind??'seek',keepPaused=target===null?paused:arrivalPaused;
  stageFallback=error.message;start({frame,kind,paused:keepPaused,forceSync:true});
  status('分面播放不可用，正在用完整确认帧历史重建：'+error.message);
}
function pumpStage(limit){
  const s=stageSession,fast=target!==null;
  try{
    if((s.waiting||s.sent-s.event<64)&&s.sync<limit){
      const first=s.sent,events=stageBatch(limit);
      if(events.length){pending=true;worker.postMessage({type:'stage-append',first,events});return;}
    }
    if(s.waiting&&s.sync>=limit){
      if(source.end&&limit===source.frames){finish();return;}
      if(target!==null){target=cursor;settleGoal();status('已定位到目标附近的完整原生边界。');}
      schedule(50);return;
    }
    if(cursor>=limit){settleGoal();schedule(50);return;}
    if(fast&&!quiet){audio?.flush();context?.suspend();}
    if(!fast&&quiet){restoreMusic();if(!paused)context?.resume();present();}
    quiet=fast;pending=true;pendingEnd=cursor+1;worker.postMessage({type:'stage-slice',steps:fast?32:1,quiet:fast});
  }catch(error){stageRecover(error);}
}
function pump(){
  if(!ready||pending||paused||completed)return;
  settleGoal();if(paused)return;
  if(source.end&&cursor===source.frames){finish();return;}
  if(nativeExited){
    if(source.frames>cursor){fail(Error('游戏已退出，但还有后续输入'));return;}
    status('游戏已退出，等待来源结束标记…');schedule(100);return;
  }
  // A seek may use every received frame; normal live play keeps its buffer.
  const limit=target===null?edge():target;
  if(stageSession){pumpStage(limit);return;}
  if(cursor>=limit){status('等待已确认帧 · 游戏帧保持不动。');nextDue=performance.now();schedule(50);return;}
  const row=source.row(cursor);if(!row){fail(Error('缺少下一帧输入'));return;}
  // Batch arrival and a slow browser must not turn passive watching into
  // silent fast-forward. Only an explicit fixed-target seek/Live accelerates.
  const fast=target!==null;
  if(fast&&!quiet){audio?.flush();context?.suspend();}
  if(!fast&&quiet){restoreMusic();if(!paused)context?.resume();present();}
  quiet=fast;pending=true;ackFrame=null;pendingEnd=cursor+1;
  if(fast){
    const rows=[];pendingEnd=Math.min(limit,cursor+32);
    for(let n=cursor;n<pendingEnd;n++){const next=source.row(n);if(!next){fail(Error('缺少推进批次输入'));return;}rows.push(next);}
    sliceStart=cursor;worker.postMessage({type:'history-slice',frame:cursor,rows});return;
  }
  worker.postMessage({type:'step',frame:cursor,pair:row.pair,offlineMask:row.offlineMask,predicted:false,quiet:fast});
}
function start(plan=null){
  if(!source||!bootstrapped)return;
  const selected=!plan?.forceSync?nearestCheckpoint(plan?.frame??(live?edge():0)):null;
  if(selected&&!plan&&live)plan={frame:edge(),kind:'live',paused:false};
  const candidate=!plan?.forceSync&&source.header.stageObservation===1?source.stages.nearest(plan?.frame??(live?edge():0)):null;
  const stage=candidate&&candidate.first<(plan?.frame??edge())?candidate:null;
  stopCore(true);cursor=0;completed=false;viewError=null;lastProof=null;sliceStats={count:0,steps:0,maxSteps:0,maxMs:0,totalMs:0};$('completed').close();
  checkpointUsed=null;checkpointAbort=new AbortController();
  if(stage){stageSession={stage:stage.stage,sync:stage.first,at:stage.at,sent:0,event:0,waiting:false,locations:new Map()};cursor=stage.first;}
  if(plan){target=plan.frame;goalKind=plan.kind;arrivalPaused=plan.paused;}
  nextDue=performance.now();
  const current=epoch,canvas=document.createElement('canvas');canvas.id='canvas';canvas.width=640;canvas.height=400;canvas.tabIndex=0;canvas.style.cssText=$('canvas').style.cssText;$('canvas').replaceWith(canvas);
  function checkpointFallback(error){
    if(current!==epoch)return;
    const frame=target??cursor,kind=goalKind??'seek',keepPaused=target===null?paused:arrivalPaused;
    start({frame,kind,paused:keepPaused,forceSync:true});status('浏览器检查点不可用，正在从确认输入重建：'+error.message);
  }
  worker=new Worker('lan-worker.js',{type:'module'});
  display=createFrameDisplay(canvas,{release:seq=>worker?.postMessage({type:'frame-ack',seq}),onError:fail});
  worker.onerror=e=>{if(current===epoch)fail(Error(e.message));};
  worker.onmessage=({data})=>{
    if(current!==epoch){data.bitmap?.close();return;}
    try{
      if(data.type==='boot-progress'){status(data.message);return;}
      if(data.type==='frame'){display.receive(data);return;}
      if(data.type==='sfx'){if(!quiet&&target===null&&!paused)audio?.push(data.events);return;}
      if(data.type==='music'){acceptMusic(data.events);return;}
      if(data.type==='error'){if(stageSession){stageRecover(Error(data.message));return;}throw Error(data.message);}
      if(data.type==='session-exit'){nativeExited=true;return;}
      if(data.type==='ready'){
        const h=source.header;
        for(const key of ['checksum','coreSha','diskSha','guestSha'])if(data[key]!==h[key])throw Error('开局或资源校验不一致：'+key);
        if(data.historyHeader?.identity!==h.identity)throw Error('旁观来源与当前适配器版本不一致');
        if(selected){
          pending=true;checkpointLoading=true;update();
          const baseEntry=[...(source.checkpoints.index()||[]),...checkpointIndex].find(e=>e.frame===0);
          if(!baseEntry)throw Error('检查点基准不存在');
          Promise.all([checkpointBytes(baseEntry),checkpointBytes(selected)]).then(([base,entry])=>{
            if(current!==epoch)return;worker.postMessage({type:'checkpoint-load',request:entry.frame,bytes:entry.bytes,baseBytes:base.bytes});status(`正在恢复帧 ${entry.frame} 的浏览器检查点…`);
          }).catch(checkpointFallback);
          return;
        }
        if(stageSession){
          pending=true;const events=stageBatch(Math.max(stageSession.sync+1,target??edge()));
          worker.postMessage({type:'stage-load',events});status(`正在从第 ${stageSession.stage+1} 面独立重建…`);update();return;
        }
        ready=true;status(target!==null?'正在从开局逐帧重建到目标…':'正在按帧重演 · Esc／空格暂停。');nextDue=performance.now();settleGoal();if(!paused&&target===null)context?.resume();schedule(0);update();return;
      }
      if(data.type==='checkpoint-loaded'){
        if(!selected||!checkpointLoading||data.frame!==selected.frame)throw Error('检查点恢复边界无效');
        const expected=source.row(data.frame-1);for(const key of ['ticks','gameHash','nativeHash'])if(data.proof?.[key]!==expected?.[key])throw Error('检查点与确认历史校验不一致：'+key);
        cursor=data.frame;lastProof=data.proof;checkpointUsed=data.frame;checkpointLoading=false;pending=false;ready=true;musicState=data.music||[];audio?.resetTimeline();nativeExited=false;nextDue=performance.now();
        settleGoal();if(source.end&&cursor===source.frames){finish();return;}
        if(!paused&&target===null){restoreMusic();context?.resume();}schedule(0);update();return;
      }
      if(data.type==='stage-loaded'||data.type==='stage-appended'){
        if(!stageSession||!pending)throw Error('分面接收确认无效');
        ready=true;pending=false;stageSession.waiting=false;nextDue=performance.now();schedule(0);update();return;
      }
      if(data.type==='stage-sliced'){
        const s=stageSession;
        if(!s||!pending||!Number.isInteger(data.event)||data.event<s.event||data.event>s.sent)throw Error('分面原生事件边界无效');
        const last=s.locations.get(data.event-1),next=s.locations.get(data.event);
        if(last!==undefined)cursor=Math.max(cursor,Math.min(last,next===undefined?s.sync:next-1));
        s.event=data.event;s.waiting=data.waiting;pending=false;
        for(const n of s.locations.keys()){if(n>=s.event-1)break;s.locations.delete(n);}
        if(target!==null&&cursor>target)target=cursor;
        settleGoal();
        if(source.end&&cursor===source.frames){finish();return;}
        if(paused){quiet=false;present();update();return;}
        if(target!==null)schedule(0);
        else{nextDue=Math.max(nextDue+TICK_MS,performance.now()-TICK_MS);schedule(Math.max(0,nextDue-performance.now()));}
        update();return;
      }
      if(data.type==='history-sliced'){
        if(!pending||ackFrame!==null||!Number.isInteger(data.applied)||data.applied<1||data.frame!==sliceStart+data.applied||data.frame>pendingEnd)throw Error('旁观批次边界不一致');
        const expected=source.row(data.frame-1);
        for(const key of ['ticks','gameHash','nativeHash'])if(data.proof?.[key]!==expected[key])throw Error(`第 ${data.frame} 同步帧校验不一致：${key}`);
        sliceStats.count++;sliceStats.steps+=data.applied;sliceStats.maxSteps=Math.max(sliceStats.maxSteps,data.applied);sliceStats.maxMs=Math.max(sliceStats.maxMs,data.sliceMs);sliceStats.totalMs+=data.sliceMs;
        cursor=data.frame;lastProof=data.proof;pending=false;ackFrame=null;settleGoal();
        if(source.end&&cursor===source.frames){finish();return;}
        if(paused){quiet=false;present();update();return;}
        if(target===null){quiet=false;present();restoreMusic();context?.resume();nextDue=performance.now();}
        schedule(target===null?TICK_MS:0);
        if(target===null||performance.now()-lastSliceUi>=100){lastSliceUi=performance.now();update();}return;
      }
      if(data.type==='stepped'){
        if(!pending||ackFrame!==null||data.frame!==cursor+1)throw Error('回放帧边界不一致');
        const expected=source.row(cursor),proof=data.proof;
        for(const key of ['ticks','gameHash','nativeHash'])if(proof?.[key]!==expected[key])throw Error(`第 ${cursor+1} 同步帧校验不一致：${key}`);
        lastProof=proof;cursor++;ackFrame=cursor;
        // Wait for effects to be consumed before completing a silent seek.
        worker.postMessage({type:'confirm',prefix:cursor,notify:true});return;
      }
      if(data.type==='history-confirmed'){
        if(!pending||ackFrame!==data.frame||cursor!==data.frame)throw Error('回放确认边界不一致');
        pending=false;ackFrame=null;settleGoal();
        if(source.end&&cursor===source.frames){finish();return;}
        if(paused){quiet=false;present();update();return;}
        if(target!==null)schedule(0);
        else {nextDue=Math.max(nextDue+TICK_MS,performance.now()-TICK_MS);schedule(Math.max(0,nextDue-performance.now()));}
        if(cursor%12===0||target!==null)update();
      }
    }catch(error){if(stageSession)stageRecover(error);else if(selected&&!ready)checkpointFallback(error);else fail(error);}
  };
  worker.postMessage({type:'boot',settings:{language:source.header.language,rollback:false},config:source.header.config,viewSlot:0,verifyHistory:true,stageObservation:source.header.stageObservation===1});
  status('正在建立与录像相同的游戏开局…');update();
}
function seek(frame,kind='seek'){
  if(!source||!bootstrapped)return;
  if(!Number.isInteger(frame)||frame<0||frame>source.frames){status('定位目标超出已收到的帧范围。');return;}
  const keepPaused=kind==='live'?false:target!==null?arrivalPaused:paused;
  $('completed').close();completed=false;following=false;
  // An outstanding step cannot be undone. Restart if it would pass the goal.
  const nextStage=source.header.stageObservation===1?source.stages.nearest(frame):null;
  const nextCheckpoint=nearestCheckpoint(frame);
  if(!worker||checkpointLoading||frame<(pending?pendingEnd:cursor)||(nextCheckpoint&&nextCheckpoint.frame>cursor)||(stageSession&&(pending||frame<stageSession.sync))||(nextStage&&nextStage.first>cursor)){start({frame,kind,paused:keepPaused});return;}
  clearSchedule();target=frame;goalKind=kind;arrivalPaused=keepPaused;paused=false;audio?.flush();context?.suspend();
  status(`正在逐帧${kind==='live'?'追赶':'定位'}到 ${frame}，可取消。`);if(!pending)settleGoal();schedule(0);update();
}
function pauseHere(){
  if(worker&&!ready){start({frame:cursor,kind:'seek',paused:true,forceSync:true});status('检查点定位已取消，正在恢复暂停位置。');return;}
  target=goalKind=null;following=false;paused=true;clearSchedule();audio?.flush();context?.suspend();
  if(!pending){quiet=false;present();}status('观看已暂停 · 定位已取消，仍接收后续帧。');update();
}
function togglePause(){
  if(!worker||completed)return;
  if(target!==null||!paused){pauseHere();return;}
  paused=false;quiet=false;restoreMusic();context?.resume();nextDue=performance.now();status('继续按帧重演。');schedule(0);update();
}
$('play').onclick=()=>start();$('pause').onclick=togglePause;$('stop').onclick=()=>{stop();status('旁观已停止，可重新打开旁观链接。');};
$('seek').onclick=()=>seek(Number($('seek-frame').value));$('timeline').onchange=()=>seek(Number($('timeline').value));
$('stage-select').onchange=()=>{if($('stage-select').value!=='')seek(Number($('stage-select').value));};
$('cancel-seek').onclick=pauseHere;$('live-edge').onclick=()=>seek(edge(),'live');
$('sound').onclick=()=>enableSound().catch(error=>status('声音未能开启：'+error.message));$('end-close').onclick=()=>$('completed').close();
addEventListener('keydown',event=>{
  if(event.target?.closest('input,button,select'))return;
  if(['Escape','Space'].includes(event.code)&&worker){event.preventDefault();if(!event.repeat&&!$('completed').open)togglePause();}
});
addEventListener('pagehide',stop);
function receive(data){
  try{
    if(data.type==='checkpoint-index'){
      if(!Array.isArray(data.entries)||data.entries.length>128)throw Error('检查点索引过大');
      let previous=-1;for(const e of data.entries){if(!Number.isInteger(e.frame)||e.frame<=previous||!Number.isInteger(e.size)||e.size<1||e.size>16*1024*1024||!/^[a-f0-9]{64}$/.test(e.sha))throw Error('检查点网络索引无效');previous=e.frame;}
      checkpointIndex=data.entries;update();return;
    }
    if(data.type==='checkpoint-data'){const waiter=checkpointWaiters.get(data.request);if(waiter){checkpointWaiters.delete(data.request);waiter.resolve(data);}return;}
    if(data.type==='begin'){
      if(source)throw Error('重复的旁观开局');source=new ConfirmedHistory(data.header);status('正在接收旁观历史…');
    }else if(data.type==='batch'&&source){source.append(data.first,data.bytes,data.stageFrames);update();}
    else if(data.type==='bootstrap'&&source){
      if(data.frames!==source.frames)throw Error('旁观历史不完整');bootstrapped=true;start();
    }else if(data.type==='end'&&source){
      if(data.frames!==source.frames)throw Error('旁观尾帧不完整');source.finish(data.reason);schedule(0);update();
    }
  }catch(error){fail(error);}
}
const params=new URLSearchParams(location.search),session=params.get('live'),watch=new URLSearchParams(location.hash.slice(1)).get('watch');
if(watch&&/^[A-Za-z0-9_-]{32,80}$/.test(watch)){
  live=true;receiving=true;
  networkReceiver=receiveNetworkHistory(watch,{onMessage:data=>{if(receiving)receive(data);},onStatus:status,onError:fail});status('正在连接跨设备旁观…');
}else if(session&&/^[a-f0-9-]{36}$/.test(session)){
  const viewer=historySessionId();localViewer=viewer;live=true;receiving=true;channel=new BroadcastChannel('th05-history-'+session);
  channel.onmessage=({data})=>{
    if(!receiving||data?.to!==viewer)return;
    if(data.type==='interrupted'){fail(Error(data.reason));return;}
    receive(data);
    if(data.type==='batch'&&!viewError)channel?.postMessage({type:'ack',viewer,frames:source.frames});
  };
  channel.postMessage({type:'subscribe',viewer});status('等待本机联机页面提供帧历史…');
}
if(params.get('qa')==='1')globalThis.th05CoopReplayQA={read:()=>({cursor,frames:source?.frames,ready,pending,paused,completed,target,goalKind,following,error:viewError,lastProof,checkpointUsed,checkpointLoading,checkpointIndex:[...(source?.checkpoints.index()||[]),...checkpointIndex],stage:stageSession?{stage:stageSession.stage,event:stageSession.event,sent:stageSession.sent,waiting:stageSession.waiting}:null,stageFallback,sliceStats:{...sliceStats},sound:context?{state:context.state,sfx:audio?.info()}:null,music:music?{status:music.status,id:music.requested?.id}:null})};
update();
