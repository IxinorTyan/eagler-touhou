import {createFastCore,prepareFastCore} from './dosbox-runtime.js';
import {loadVerifiedBytes} from './startup-assets.js';
import {mountPlayer} from './player-ui.js';
import {unpackTouch} from './touch-input.js';
import {createBrowserRecorder} from './browser-replay-recorder.js';
import {mountPractice} from './practice-ui.js';

const $=id=>document.getElementById(id);
let emulator=null,busy=false,disposed=false,oldButtons=0,lastInfo=0,menuBits=0,menuUntil=0;
let recorder=null,recordBlob=null,lastRecordInput='';
const recordingStatus=text=>{if($('record-status'))$('record-status').textContent=text;};
function discardRecording(){recordBlob=null;if($('record-save'))$('record-save').disabled=true;if($('record-discard'))$('record-discard').disabled=true;$('replay-save-dialog')?.close();}
function clearRecorder(){recorder?.dispose();recorder=null;lastRecordInput='';if($('record-finish'))$('record-finish').disabled=true;}
const held=new Set(),pulses=new Map();
const keys={ArrowUp:1,ArrowDown:2,ArrowLeft:4,ArrowRight:8,KeyX:16,KeyZ:32,ShiftLeft:64,ShiftRight:64,Escape:128,Enter:256};
const nativeCodes=[[1,265],[2,264],[4,263],[8,262],[16,88],[32,90],[64,340],[128,256],[256,257]];
const player=mountPlayer($('player'),{solo:true,onGesture:enableSound});
$('screen').classList.add('screen');player.stage.append($('screen'));
player.setLabel('原版单人');player.note('启动后使用原版标题菜单；触屏可开启触屏操作。');
const practiceUI=mountPractice({host:$('player'),onChange:value=>{if(value){emulator?.practiceOptions(value);if(value.preparedRetry===false)discardRetry();if(value.preparedRetry===true)retryBlocked=false;}},onStart:value=>start({practiceConfig:value}),onRetry:retryPractice,onSave:()=>$('record-save').click(),onPause:()=>{if(emulator?.readState()?.mode===1)pause();},onFocus:()=>$('canvas').focus()});
let activePractice=null,practiceCompleted=false,activeAttempt=null,retrySlot=null,retryBlocked=false,lastRetry=null,warmAfter=0;
function finishPractice(outcome='clear'){
  if(activePractice?.mode!=='target'||practiceCompleted)return;practiceCompleted=outcome;
  if(recorder)emulator?.pauseReplay(true);else emulator?.pause();
  release();status((outcome==='clear'?'练习成功':'练习失败')+' · 可保存本次 REP 或继续练习。');
  practiceUI.complete({outcome,recording:!!recorder,ready:!!recordBlob,failed:recorder?.state.failed});
}
function retryPractice(){if(activePractice?.mode!=='target'||busy)return;start({retry:true});}
function canvasForAttempt(){
  const canvas=document.createElement('canvas');canvas.id='canvas';canvas.width=640;canvas.height=400;canvas.tabIndex=0;canvas.setAttribute('aria-label','怪绮谈原版单人游戏画面');canvas.onpointerdown=()=>canvas.focus();return canvas;
}
function discardRetry(){const previous=retrySlot;retrySlot=null;previous?.stop();}
function attemptKey(language,recordEnabled,practice){return JSON.stringify([language,recordEnabled,practice.version,practice.mode,practice.setup]);}
function makeAttempt({language,recordEnabled,practice,standby=false}){
  const attempt={language,recordEnabled,practice,standby,canvas:canvasForAttempt(),core:null,recorder:null,foreground:false,cancelled:false,ready:false,abort:new AbortController(),
    stop(){this.cancelled=true;this.foreground=false;this.abort.abort();this.recorder?.dispose();this.core?.stop();}};
  attempt.key=attemptKey(language,recordEnabled,practice);
  attempt.task=(async()=>{
    try{
      const coreTask=prepareFastCore(!!practice);coreTask.catch(()=>{});
      const {disk,patch,practiceExe}=await readDisk(language,practice);if(attempt.cancelled)throw Error('练习已取消');
      if(recordEnabled){
        try{attempt.recorder=await createBrowserRecorder({language,practice,independentMusic:true,
          onStatus:text=>{if(!attempt.foreground)return;recordingStatus(text);if(practiceCompleted&&attempt.recorder?.state.failed)practiceUI.complete({outcome:practiceCompleted,failed:true});},
          onRun:()=>{if(attempt.foreground)$('record-finish').disabled=false;},
          onResult:()=>{if(attempt.foreground)$('record-finish').disabled=true;},
          onFile:(blob,result)=>{
            if(!attempt.foreground)return;recordBlob=blob;$('record-save').disabled=false;$('record-discard').disabled=false;
            if(['practice-clear','practice-failed'].includes(result.endReason)){const outcome=result.endReason==='practice-clear'?'clear':'failed';finishPractice(outcome);practiceUI.complete({outcome,ready:true});return;}
            $('replay-save-title').textContent='本局结束，保存单人 Replay？';
            $('replay-save-summary').textContent=`${result.endReason==='clear'?'已通关。':'录像已封存。'}只包含首次续关前的操作，不包含续关和后续操作。`;
            $('replay-save-dialog').showModal();}});
        }catch(error){attempt.recordingError=error.message;}
      }
      if(attempt.cancelled)throw Error('练习已取消');
      const core=await createFastCore({canvas:attempt.canvas,disk,patch,solo:true,independentMusic:true,coreTask,externalReplay:attempt.recorder?.config,practice,practiceExe,standby,signal:attempt.abort.signal});
      attempt.core=core;if(attempt.cancelled){core.stop();throw Error('练习已取消');}
      attempt.recorder?.attach(core);
      if(standby){const failed=()=>{attempt.stop();if(retrySlot===attempt){retrySlot=null;retryBlocked=true;}};core.onError=failed;core.onExit=failed;await core.prepared;}
      attempt.ready=true;return attempt;
    }catch(error){attempt.stop();throw error;}
  })();
  return attempt;
}
function prepareRetry(){
  if(disposed||busy||retrySlot||retryBlocked||!practiceUI.options.preparedRetry||document.hidden||activePractice?.mode!=='target'||!activeAttempt||!emulator?.readState()?.practice?.ready||performance.now()<warmAfter)return;
  const slot=makeAttempt({language:activeAttempt.language,recordEnabled:!!$('record-enabled')?.checked,practice:{...activePractice,options:practiceUI.options},standby:true});retrySlot=slot;
  slot.task.catch(()=>{if(retrySlot===slot){retrySlot=null;retryBlocked=true;}});
}
const status=text=>{$('status').textContent=text;};
const form=target=>target?.closest?.('select,input,textarea,button,a');
function enableSound(){const practice=emulator?.readState()?.practice;if(activePractice?.mode==='target'&&(!practice?.ready||practice.waiting))return;if(emulator?.state==='running')return emulator.audio?.resume();}
function applyButtons(value){
  if(!emulator)return;
  for(const [bit,code]of nativeCodes)if((value^oldButtons)&bit)emulator.key(code,!!(value&bit));
  oldButtons=value;
}
function points(){return ($('focus-point').checked?1:0)|((player.alwaysPoint()||activePractice&&practiceUI.options.alwaysPoint)?8:0);}
function release(){
  held.clear();pulses.clear();menuBits=menuUntil=0;player.reset();applyButtons(0);
  emulator?.inputs({generation:emulator.readState()?.generation,points:points(),touch:null});
}
function pulse(bit){pulses.set(bit,performance.now()+110);syncButtons();}
function context(){
  const state=emulator?.readState(),game=state?.mode===1;
  player.setActive(emulator?.state==='running');
  // Native status distinguishes play, injury/entry, pause, demo and transitions.
  // As in TH04, keep the fire preference through stage/context changes, while
  // suppressing its output in menus and temporarily blocked player states.
  player.setContext({key:`${state?.at??-1}:${state?.generation||0}:${game?'game':'menu'}`,
    play:emulator?.state==='running'&&!document.hidden&&game&&!state.flags});
  return state;
}
function pause(){
  if(emulator?.state!=='running'||![1,2].includes(emulator.readState()?.mode))return;
  release();emulator.gamePause();$('canvas').focus();
}
for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
  if(!emulator||!(event.code in keys))return;
  if(type==='keydown'&&(event.ctrlKey||event.metaKey||event.altKey))return;
  if(form(event.target)&&!held.has(event.code))return;
  if(emulator.state!=='running')return;
  event.preventDefault();
  if(type==='keydown'){
    held.add(event.code);enableSound();
  }else held.delete(event.code);
  // Native keyboard state can reach the Worker before the next display tick.
  // Sampling here never packs/consumes touch displacement or advances pulses.
  syncButtons();
});
for(const button of document.querySelectorAll('[data-key]')){
  button.onclick=()=>{if(emulator?.state==='running'){enableSound();pulse(keys[button.dataset.key]);}};
}
window.addEventListener('blur',release);
document.addEventListener('focusin',event=>{if(form(event.target))release();});
document.addEventListener('visibilitychange',()=>{
    if(document.hidden){release();if(emulator?.state==='running'&&emulator.readState()?.mode===1)emulator.gamePause({onlyPause:true});}
});
window.addEventListener('pagehide',()=>{disposed=true;release();discardRetry();activeAttempt?.stop();clearRecorder();emulator?.stop();});
function sampleButtons(now,state){
    const game=state?.mode===1;
    let base=0;for(const key of held)base|=keys[key];
    let value=player.sample(base);
    // DOS menus poll independently. TH04 holds touch edges for 100 ms, while
    // gameplay movement goes through the accumulated native touch mailbox.
    if(!game){
      const touchButtons=value&~base;
      if(touchButtons){menuBits=touchButtons;menuUntil=now+110;}
      if(now<menuUntil)value|=menuBits;else menuBits=0;
    }else{
      menuBits=menuUntil=0;
      for(const bit of [16,128,256])if((value&~base)&bit)pulses.set(bit,now+110);
    }
    for(const [bit,until]of pulses)if(now<until)value|=bit;else pulses.delete(bit);
    if((value&3)===3)value&=~3;if((value&12)===12)value&=~12;
    return value;
}
function syncButtons(){
  if(emulator?.state==='running')applyButtons(sampleButtons(performance.now(),context()));
}
function tick(now){
  if(disposed)return;
  const state=context();prepareRetry();
  if(activePractice){practiceUI.update(state);if(activePractice.mode==='target'&&state?.practice?.ready&&retrySlot?.ready){const label=document.querySelector('[data-practice-status]');label.textContent+=' · 下次重试已就绪';}if(state?.practice?.error)status(state.practice.error);else if(activePractice.mode==='target'&&state?.practice?.ready&&!practiceCompleted)status(state.practice.waiting?'练习入口已就绪 · 原版暂停中，按 Enter / Esc 继续。':'单人练习运行中 · 入口已就绪。');}
  if(emulator){$('pause').disabled=practiceCompleted||![1,2].includes(state?.mode);$('pause').textContent=state?.mode===2?'继续游戏':'暂停游戏';}
  if(emulator?.state==='running'){
    const game=state?.mode===1,value=sampleButtons(now,state);
    applyButtons(value);
    const touch=unpackTouch(player.pack(value));
    const command={generation:state?.generation,points:points(),touch:game&&!state.flags?touch:null};
    // Keep active deltas (even identical ones); idle preferences need one edge.
    const encoded=JSON.stringify(command),moving=command.touch?.active;
    if(!recorder||moving||encoded!==lastRecordInput){emulator.inputs(command);lastRecordInput=encoded;}
    if(recorder&&player.unlimited()&&!recorder.state.failed){recorder.disable();discardRecording();}
    player.consume();
  }
  if(emulator&&now-lastInfo>500){
    lastInfo=now;
    const text=JSON.stringify({mode:'original-solo',status:emulator.state,music:emulator.bgm?.status||'PC-98',musicError:emulator.musicError,retryCache:{state:retrySlot?(retrySlot.ready?'ready':'preparing'):retryBlocked?'unavailable':'idle',last:lastRetry},state:emulator.readState()},null,2);
    $('diagnostics').textContent=text;player.diagnostics(text);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

async function readDisk(language,practice){
  const manifestResponse=await fetch('solo-disks.json',{cache:'no-store'});
  if(!manifestResponse.ok)throw Error('原版磁盘清单读取失败');
  const item=(await manifestResponse.json()).languages[language];
  if(!item.inputPatch)throw Error('原版单人触摸资源需要更新，请重新生成单人磁盘');
  const disk=await loadVerifiedBytes(new URL(item.url,import.meta.url),item.sha256,{gzip:true,size:item.size});
  if(!practice)return {disk,patch:item.inputPatch};
  const response=await fetch('practice-assets.json',{cache:'no-store'});if(!response.ok)throw Error('练习资源清单读取失败');const spec=(await response.json()).languages[language];
  if(spec.sourceMainSha256!==item.inputPatch.main_sha256)throw Error('练习资源与单人程序不一致，请重建练习资源');
  const practiceExe=await loadVerifiedBytes(new URL(spec.url,import.meta.url),spec.sha256,{gzip:true,size:spec.size});
  return {disk,patch:spec.patch,practiceExe};
}
function failure(error){
  discardRetry();activeAttempt?.stop();activeAttempt=null;clearRecorder();
  practiceUI.setRunning(false);
  release();if(emulator&&!['failed','stopped'].includes(emulator.state))emulator.stop();emulator=null;player.setActive(false);
  status('启动或运行失败：'+error.message);player.note('请查看错误原因，调整后重新开始。');
  $('start').disabled=false;$('pause').disabled=true;$('capture').disabled=true;$('sound').disabled=true;
}
function endSession(){
  discardRetry();activeAttempt?.stop();activeAttempt=null;clearRecorder();
  practiceUI.setRunning(false);
  emulator?.stop();emulator=null;held.clear();pulses.clear();oldButtons=0;player.setActive(false);player.exit();
  const canvas=$('canvas');canvas.replaceWith(canvas.cloneNode(false));
  for(const id of ['pause','capture','sound'])$(id).disabled=true;
  $('start').disabled=false;$('restart').disabled=false;status('已退出模拟器，本局结束。可重新启动原版。');
}
async function start({retry=false,practiceConfig=null}={}){
  if(busy||disposed)return;busy=true;const retryStarted=performance.now();
  const language=$('language').value,recordEnabled=!!$('record-enabled')?.checked;
  const nextPractice=practiceConfig||(retry&&activePractice?{...activePractice,options:practiceUI.options}:practiceUI.configuration());
  let attempt=retry&&retrySlot?.key===attemptKey(language,recordEnabled,nextPractice)?retrySlot:null;
  let cached=!!attempt;const cachedReady=!!attempt?.ready;
  if(attempt)retrySlot=null;else discardRetry();
  release();activeAttempt?.stop();activeAttempt=null;emulator?.stop();emulator=null;
  practiceCompleted=false;clearRecorder();discardRecording();retryBlocked=false;
  for(const id of ['start','restart','pause','capture','sound'])$(id).disabled=true;
  player.setActive(false);status(cachedReady?'正在恢复练习起点…':cached?'正在完成练习起点准备…':'正在载入原版磁盘…');
  $('bgm-control').hidden=false;
  activePractice=nextPractice;practiceUI.setRunning(false);
  try{
    attempt??=makeAttempt({language,recordEnabled,practice:nextPractice});activeAttempt=attempt;
    try{await attempt.task;}catch(error){
      if(!cached||disposed)throw error;
      cached=false;status('预备起点不可用，正在重新准备练习…');
      attempt=makeAttempt({language,recordEnabled,practice:nextPractice});activeAttempt=attempt;await attempt.task;
    }
    if(disposed){attempt.stop();return;}
    const core=attempt.core;
    $('canvas').replaceWith(attempt.canvas);activeAttempt=attempt;attempt.foreground=true;
    emulator=core;recorder=attempt.recorder;emulator.onError=failure;emulator.onExit=endSession;
    practiceUI.setRunning(!!activePractice,activePractice);core.onPracticeRetry=retryPractice;core.onPracticeComplete=finishPractice;
    if(cached)core.activatePractice(practiceUI.options);
    if(retry)lastRetry={cached,cachedReady,milliseconds:Math.round(performance.now()-retryStarted)};
    warmAfter=performance.now()+400;
    if(recorder){$('record-finish').disabled=!recorder.state.run;recordingStatus(recorder.state.run?'浏览器正在录制本次练习。':'浏览器已记录启动流程，等待进入关卡。');}
    else recordingStatus(attempt.recordingError?'录像未能启动：'+attempt.recordingError+'；游戏继续。':'本次启动不录制。');
    emulator.bgm?.setVolume(Number($('bgm-volume').value)/100);
    $('pause').disabled=false;$('capture').disabled=false;$('sound').disabled=false;
    $('pause').textContent='暂停游戏';player.setLabel(`${language==='cn'?'汉化版':'日文版'} · 原版单人`);
    status(activePractice?.mode==='target'?(cached?'练习起点已恢复 · 原版暂停中，按 Enter / Esc 继续。':'单人练习运行中 · 正在准备所选入口。'):'原版单人运行中 · 请在标题菜单选择角色与难度。');
    player.note('方向键选择，Z / Enter 确认，X 返回。Esc 打开原版暂停菜单。');
    attempt.canvas.focus();if(document.hidden)pause();
  }catch(error){attempt?.stop();if(!disposed)failure(error);}
  finally{busy=false;if(!disposed)$('restart').disabled=false;}
}
$('start').onclick=start;$('restart').onclick=start;$('pause').onclick=pause;
if($('record-finish'))$('record-finish').onclick=()=>recorder?.finish();
if($('record-save'))$('record-save').onclick=()=>{
  if(!recordBlob)return;const url=URL.createObjectURL(recordBlob),link=document.createElement('a');
  link.href=url;link.download=practiceCompleted?'th05-practice.th05r':'th05-solo-browser.th05r';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('replay-save-dialog')?.close();
};
if($('record-discard'))$('record-discard').onclick=()=>{discardRecording();recordingStatus('录像已丢弃，游戏继续。');};
if($('replay-prompt-save'))$('replay-prompt-save').onclick=()=>$('record-save').click();
if($('replay-prompt-discard'))$('replay-prompt-discard').onclick=()=>$('record-discard').click();
$('replay-save-dialog')?.addEventListener('cancel',event=>event.preventDefault());
$('fullscreen').onclick=()=>player.enter();$('sound').onclick=enableSound;
$('bgm-volume').oninput=()=>emulator?.bgm?.setVolume(Number($('bgm-volume').value)/100);
$('capture').onclick=async()=>{
  if(!emulator)return;
  try{
    const blob=await emulator.capture(),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='th05-solo.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){status('保存画面失败：'+error.message);}
};
