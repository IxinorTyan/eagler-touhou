import {ConfirmedHistory,historySessionId} from './netplay/confirmed-history.js';
import {decodeMultiplayerReplay} from './netplay/history-codec.js';
import {receiveNetworkHistory} from './netplay/history-network.js';
import {createFrameDisplay} from './frame-display.js';
import {LocalSfx} from './netplay/local-sfx.js';
import {LocalBgm} from './netplay/local-bgm.js';
const $=id=>document.getElementById(id),TICK_MS=1000/60;
let source=null,worker=null,display=null,channel=null,context=null,audio=null,music=null;
let cursor=0,epoch=0,pending=false,paused=false,ready=false,completed=false,timer=0,lastProof=null,live=false,bootstrapped=false,receiving=false;
let viewError=null,musicState=[],target=null,goalKind=null,arrivalPaused=false,following=false,quiet=false,ackFrame=null,nativeExited=false,nextDue=0;
let wakeSerial=0,networkReceiver=null,importSerial=0;
const wake=new MessageChannel();wake.port1.onmessage=({data})=>{if(data===wakeSerial)pump();};
const status=text=>{$('status').textContent=text;};
const edge=()=>source?.end?source.frames:Math.max(0,(source?.frames||0)-90);
function update(){
  $('play').disabled=!source||!!worker;$('pause').disabled=!worker||completed;$('stop').disabled=!worker&&!receiving;
  $('file').disabled=!!worker||receiving;$('pause').textContent=paused?'继续播放':'暂停播放';
  $('timeline').max=source?.frames||0;$('timeline').value=cursor;$('timeline').disabled=!source;
  $('seek-frame').max=source?.frames||0;$('seek').disabled=!source;$('cancel-seek').disabled=target===null;
  $('live-edge').disabled=!source||!live||!!source.end;
  $('progress').textContent=source?`已播放 ${cursor} / 已收到 ${source.frames} 同步帧${target!==null?` · 正在${goalKind==='live'?'追赶':'定位'}到 ${target}`:following?` · 跟随直播，落后 ${Math.max(0,edge()-cursor)} 帧`:''}`:'';
  $('diagnostics').textContent=JSON.stringify({cursor,received:source?.frames,paused,ready,completed,pending,target,goalKind,following,lastProof,error:viewError,endpoint:source?.end},null,2);
}
function clearSchedule(){clearTimeout(timer);wakeSerial++;}
function stopCore(preserveSound=false){
  epoch++;clearSchedule();worker?.terminate();worker=null;display?.stop();display=null;
  if(preserveSound){
    audio?.resetTimeline();music?.stop();if(music)music.pendingCommands=[];context?.suspend();
  }else{
    audio?.disconnect();audio=null;music?.dispose();music=null;context?.close().catch(()=>{});context=null;
  }
  ready=pending=paused=false;musicState=[];target=goalKind=ackFrame=null;quiet=following=nativeExited=false;update();
}
function stop(){
  if(receiving&&source&&!source.end)source.finish('观看者停止接收，保留已收到片段');
  receiving=false;channel?.close();channel=null;networkReceiver?.close();networkReceiver=null;stopCore();$('completed').close();update();
}
function fail(error){viewError=error.message;stop();status('回放停止：'+error.message);update();}
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
  status('本段回放已结束 · 逐帧校验一致。');
  $('end-summary').textContent=`已播放 ${cursor} 个已确认同步帧，输入、原生计数和状态检查一致。停在这里是正常结束。这是所保存／接收片段的终点，不代表游戏通关。`;
  $('completed').showModal();update();
}
function settleGoal(){
  if(target===null||cursor!==target)return false;
  const kind=goalKind;target=goalKind=null;paused=arrivalPaused;following=kind==='live'&&!source.end;quiet=false;
  present();restoreMusic();if(!paused&&!completed)context?.resume();nextDue=performance.now();
  status(paused?'定位完成 · 观看保持暂停。':following?'已到达追赶目标，继续跟随已确认帧。':'定位完成 · 继续播放。');update();return true;
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
  if(cursor>=limit){status('等待已确认帧 · 游戏帧保持不动。');nextDue=performance.now();schedule(50);return;}
  const row=source.row(cursor);if(!row){fail(Error('缺少下一帧输入'));return;}
  const fast=target!==null||(following&&edge()-cursor>12);
  if(fast&&!quiet){audio?.flush();context?.suspend();}
  if(!fast&&quiet){restoreMusic();if(!paused)context?.resume();present();}
  quiet=fast;pending=true;ackFrame=null;
  worker.postMessage({type:'step',frame:cursor,pair:row.pair,offlineMask:row.offlineMask,predicted:false,quiet:fast});
}
function start(plan=null){
  if(!source||!bootstrapped)return;
  stopCore(true);cursor=0;completed=false;viewError=null;lastProof=null;$('completed').close();
  if(plan){target=plan.frame;goalKind=plan.kind;arrivalPaused=plan.paused;}
  nextDue=performance.now();
  const current=epoch,canvas=document.createElement('canvas');canvas.id='canvas';canvas.width=640;canvas.height=400;canvas.tabIndex=0;canvas.style.cssText=$('canvas').style.cssText;$('canvas').replaceWith(canvas);
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
      if(data.type==='error')throw Error(data.message);
      if(data.type==='session-exit'){nativeExited=true;return;}
      if(data.type==='ready'){
        const h=source.header;
        for(const key of ['checksum','coreSha','diskSha','guestSha'])if(data[key]!==h[key])throw Error('开局或资源校验不一致：'+key);
        if(data.historyHeader?.identity!==h.identity)throw Error('多人 Replay 与当前适配器版本不一致，请重新录制');
        ready=true;status(target!==null?'正在从开局逐帧重建到目标…':'正在按帧重演 · Esc／空格暂停。');nextDue=performance.now();settleGoal();if(!paused&&target===null)context?.resume();schedule(0);update();return;
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
        if(target!==null||(following&&edge()-cursor>12))schedule(0);
        else {nextDue=Math.max(nextDue+TICK_MS,performance.now()-TICK_MS);schedule(Math.max(0,nextDue-performance.now()));}
        if(cursor%12===0||target!==null)update();
      }
    }catch(error){fail(error);}
  };
  worker.postMessage({type:'boot',settings:{language:source.header.language,rollback:false},config:source.header.config,viewSlot:0,verifyHistory:true});
  status('正在建立与录像相同的游戏开局…');update();
}
function seek(frame,kind='seek'){
  if(!source||!bootstrapped)return;
  if(!Number.isInteger(frame)||frame<0||frame>source.frames){status('定位目标超出已收到的帧范围。');return;}
  const keepPaused=kind==='live'?false:target!==null?arrivalPaused:paused;
  $('completed').close();completed=false;following=false;
  // An outstanding step cannot be undone. Restart if it would pass the goal.
  if(!worker||frame<cursor+(pending&&ackFrame===null?1:0)){start({frame,kind,paused:keepPaused});return;}
  clearSchedule();target=frame;goalKind=kind;arrivalPaused=keepPaused;paused=false;audio?.flush();context?.suspend();
  status(`正在逐帧${kind==='live'?'追赶':'定位'}到 ${frame}，可取消。`);if(!pending)settleGoal();schedule(0);update();
}
function pauseHere(){
  target=goalKind=null;following=false;paused=true;clearSchedule();audio?.flush();context?.suspend();
  if(!pending){quiet=false;present();}status('观看已暂停 · 定位已取消，仍接收后续帧。');update();
}
function togglePause(){
  if(!worker||completed)return;
  if(target!==null||!paused){pauseHere();return;}
  paused=false;quiet=false;restoreMusic();context?.resume();nextDue=performance.now();status('继续按帧重演。');schedule(0);update();
}
$('file').onchange=async()=>{const request=++importSerial;try{
  const file=$('file').files[0];if(!file)return;stop();const decoded=await decodeMultiplayerReplay(file);if(request!==importSerial)return;
  source=decoded;live=false;bootstrapped=true;cursor=0;completed=false;viewError=null;status(`已导入 ${source.frames} 个已确认同步帧。`);update();
}catch(error){if(request===importSerial){source=null;fail(error);}}};
$('play').onclick=()=>start();$('pause').onclick=togglePause;$('stop').onclick=()=>{stop();status('观看已停止，可重新播放或导入文件。');};
$('seek').onclick=()=>seek(Number($('seek-frame').value));$('timeline').onchange=()=>seek(Number($('timeline').value));
$('cancel-seek').onclick=pauseHere;$('live-edge').onclick=()=>seek(edge(),'live');
$('sound').onclick=()=>enableSound().catch(error=>status('声音未能开启：'+error.message));$('end-close').onclick=()=>$('completed').close();
addEventListener('keydown',event=>{
  if(event.target?.closest('input,button'))return;
  if(['Escape','Space'].includes(event.code)&&worker){event.preventDefault();if(!event.repeat&&!$('completed').open)togglePause();}
});
addEventListener('pagehide',stop);
function receive(data){
  try{
    if(data.type==='begin'){
      if(source)throw Error('重复的旁观开局');source=new ConfirmedHistory(data.header);status('正在接收旁观历史…');
    }else if(data.type==='batch'&&source){source.append(data.first,data.bytes);update();}
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
  const viewer=historySessionId();live=true;receiving=true;channel=new BroadcastChannel('th05-history-'+session);
  channel.onmessage=({data})=>{if(receiving&&(!data?.to||data.to===viewer))receive(data);};
  channel.postMessage({type:'subscribe',viewer});status('等待本机联机页面提供帧历史…');
}
if(params.get('qa')==='1')globalThis.th05CoopReplayQA={read:()=>({cursor,frames:source?.frames,ready,pending,paused,completed,target,goalKind,following,error:viewError,lastProof,sound:context?{state:context.state,sfx:audio?.info()}:null,music:music?{status:music.status,id:music.requested?.id}:null})};
update();
