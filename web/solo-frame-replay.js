import {createFastCore} from './dosbox-runtime.js';
import {loadVerifiedBytes,loadCompiledCore} from './startup-assets.js';
import {sha256} from './netplay/sha256.js';
import {FRAME_VERSION,encodeFrameReplay,decodeFrameReplay} from './frame-replay-codec.js';
import {createReplayStore} from './external-replay-store.js';
const $=id=>document.getElementById(id),held=new Set(),controls=new Set(),sentKeys=new Set();
let fastTimer=null,fastPulse=false;
const keys={ArrowUp:265,ArrowDown:264,ArrowLeft:263,ArrowRight:262,KeyX:88,KeyZ:90,ShiftLeft:340,ShiftRight:340,Escape:256,Enter:257};
let core=null,mode=null,busy=false,store=null,bytes=0,metadata=null,result=null,loaded=null,recording=null,paused=false,run=null,dialog=false,ending=false;
let tainted=false,session=0,recordEpoch=0;
const cheat=()=>$('invincible')?.checked||false;
function invalidateReplay(){
  recordEpoch++;tainted=true;store?.dispose();store=null;recording=null;loaded=null;result=null;bytes=0;
  $('save-dialog').close();core?.setReplayCheat(cheat());
  if(core?.state==='paused'&&mode==='record')core.pauseReplay(false);
  status('已启用作弊，本局不保存 Replay。关闭作弊后，新的一局恢复录制。');update();
}
function setCheat(){
  if(mode==='playback'){if($('invincible'))$('invincible').checked=false;return;}
  if(cheat())invalidateReplay();else{core?.setReplayCheat(false);update();}
}
const status=text=>{$('status').textContent=text;};
async function resources(language,testProfile){
  const names=['solo-disks.json','frame-replay.json','frame-replay-core.json','vendor/dosbox-x/runtime.json','music-patch.json'];
  const [diskManifest,replayManifest,replayCore,runtime,music]=await Promise.all(names.map(async name=>{const r=await fetch(name,{cache:'no-store'});if(!r.ok)throw Error('Replay 资源清单读取失败');return r.json();}));
  const sourceNames=['frame-replay-bridge.js','frame-replay-codec.js','dosbox-worker.js','dosbox-runtime.js'];
  const sources=await Promise.all(sourceNames.map(async name=>[name,await sha256(new Uint8Array(await (await fetch(name,{cache:'no-store'})).arrayBuffer()))]));
  const item=diskManifest.languages[language],normal=replayManifest.languages[language],overlay=testProfile?normal.tests[testProfile]:normal,endingOverlay=replayManifest.ending;
  const identity=await sha256(new TextEncoder().encode(JSON.stringify({item,overlay,endingOverlay,replayCore,runtime,music,sources})));
  const [disk,exe,endingExe,compiled]=await Promise.all([
    loadVerifiedBytes(new URL(item.url,import.meta.url),item.sha256,{gzip:true,size:item.size}),
    loadVerifiedBytes(new URL(overlay.url,import.meta.url),overlay.sha256,{gzip:true,size:overlay.size}),
    loadVerifiedBytes(new URL(endingOverlay.url,import.meta.url),endingOverlay.sha256,{gzip:true,size:endingOverlay.size}),
    loadCompiledCore(new URL(replayCore.url,import.meta.url),replayCore.sha256),
  ]);
  return {disk,exe,endingExe,patch:overlay.patch,compiled,identity};
}
function update(){
  $('record').disabled=busy||!!core;$('finish').disabled=busy||mode!=='record'||!run||!!result||ending||tainted;
  $('download').disabled=busy||!recording||tainted||cheat();$('play').disabled=busy||!(loaded||recording)||cheat();
  $('hold').disabled=busy||mode!=='playback'||!!result;$('stop').disabled=busy||!core;
  $('file').disabled=busy||!!core;$('language').disabled=busy||!!core;
  $('test-case').disabled=busy||!!core;
  if($('invincible'))$('invincible').disabled=busy||mode==='playback';
  if($('restart'))$('restart').disabled=busy;
  for(const id of ['pause','capture','sound'])if($(id))$(id).disabled=busy||!core;
  if($('pause'))$('pause').textContent=mode==='playback'?'暂停 / 继续回放':'暂停游戏';
  if($('replay-state'))$('replay-state').textContent=mode==='playback'?'REPLAY PLAYBACK':cheat()||tainted?'REPLAY OFF · 本局作弊':run&&!result?'REPLAY REC':'REPLAY AUTO · 进入关卡后录制';
}
function close(){session++;recordEpoch++;release();core?.stop();core=null;store?.dispose();store=null;held.clear();mode=null;paused=false;run=null;dialog=false;ending=false;$('save-dialog').close();$('end-dialog').close();$('hold').textContent='暂停播放';update();}
function failure(error){close();busy=false;status('实验停止：'+error.message);update();}
function key(code,down){
  if(!core)return;
  if(down&&((result&&mode==='playback')||busy||$('save-dialog').open||(mode!=='record'&&!(dialog&&!paused&&[90,88,257].includes(code)))))return;
  const pressed=code===90?(down||fastPulse):down;
  if(pressed)sentKeys.add(code);else sentKeys.delete(code);core.key(code,pressed);
}
async function start(playback=null){
  if(playback&&cheat()){status('请先关闭作弊，再播放 Replay。');return;}
  if(busy)return;busy=true;close();result=null;if(!playback)recording=null;bytes=0;
  tainted=!playback&&cheat();const owner=session;
  mode=playback?'playback':'record';const language=playback?.header.language||$('language').value;
  const testProfile=playback?playback.header.testProfile:$('test-case').value||undefined;
  $('test-case').value=testProfile||'';
  $('language').value=language;status(playback?'正在载入游戏与录像开局条件…':'准备游戏 · 进入关卡才开始记录输入…');update();
  try{
    const {disk,exe,endingExe,patch,compiled,identity}=await resources(language,testProfile);
    if(playback&&playback.header.identity!==identity)throw Error('录像与当前游戏／输入适配器版本不一致');
    metadata={version:FRAME_VERSION,language,identity,...(testProfile?{testProfile}:{})};
    const canvas=document.createElement('canvas');canvas.id='canvas';canvas.width=640;canvas.height=400;canvas.tabIndex=0;canvas.style.cssText=$('canvas').style.cssText;canvas.setAttribute('aria-label','TH05 单人 Replay 画面');$('canvas').replaceWith(canvas);
    core=await createFastCore({canvas,disk,patch,solo:true,independentMusic:true,coreTask:Promise.resolve(compiled),frameReplay:{
      mode,exe,endingExe,header:playback?.header,inputs:playback?.inputs.slice(),
      onRun:started=>{ending=false;recordEpoch++;tainted=!!started.tainted||cheat();if(mode==='record'){store?.dispose();store=tainted?null:createReplayStore(failure);recording=null;result=null;bytes=0;}run=started;status(tainted?'本局已启用作弊，不保存 Replay。':mode==='record'?'正在记录游戏帧输入 · 暂停菜单与等待时间不写入录像。':'游戏正在播放 Replay · Esc / 空格暂停，剧情可按 Z 或 Enter 推进。');update();},
      onDialog:active=>{releaseKeys();dialog=active;updateFast();if(mode==='playback')status(active?'剧情中 · Z / Enter 推进，按住 Ctrl 连续对话，Esc / 空格暂停。':'游戏正在播放 Replay · Esc / 空格暂停。');},
      onPhase:()=>{ending=true;status('已通关 · 正在跳过结局动画并生成成绩／评价画面…');update();},
      onChunk:inputs=>{if(!tainted){bytes+=inputs.length;store?.add(inputs);}},
      onEnd:async ended=>{
        if(owner!==session)return;
        if(mode==='record'&&(tainted||ended.discarded)){result=null;continueGame();status('本局使用过作弊，不保存 Replay；可继续游玩。');return;}
        release();result=ended;busy=true;update();
        const sealing=recordEpoch;
        try{
          if(mode==='record'){
            const blob=await encodeFrameReplay({...metadata,...ended},await store.finish());
            if(owner!==session||sealing!==recordEpoch||tainted||cheat())return;
            recording=blob;
            const endpoint=ended.ending?'已到达通关成绩／评价画面。':'本局结束。',label=testProfile?'结算流程测试录像 · ':'';
            status(`${label}${endpoint} ${ended.frames} 游戏帧，文件 ${(recording.size/1024).toFixed(1)} KiB。`);
            const character=['灵梦','魔理沙','魅魔','幽香'][ended.state.character],rank=['Easy','Normal','Hard','Lunatic','Extra'][ended.state.rank];
            $('save-size').textContent=`${label}${character} · ${rank} · ${ended.ending?'通关':`第 ${ended.state.stage+1} 关`}\n${ended.frames} 帧 · ${(recording.size/1024).toFixed(1)} KiB`;$('save-dialog').showModal();
          }else {
            core.pauseReplay(true);
            status(ended.matches?`Replay 播放完成 · ${ended.frames} 帧，关键游戏状态校验一致。`:'Replay 失步：结束游戏状态不一致。');
            $('end-title').textContent=ended.matches?'Replay 已播放完毕':'Replay 校验不一致';
            $('end-summary').textContent=ended.matches?`${testProfile?'这是结算流程测试录像。':''}${ended.ending?'已到达通关成绩／评价画面。':''}已播放完文件中的 ${ended.frames} 个游戏帧，关键状态校验一致。停在这里是正常结束；可以再次播放，或结束回放后导入其他文件。`:'回放已停止，但结束时的关键游戏状态与录像不一致。请保留该文件用于排查，这不属于正常播放完成。';
            $('end-dialog').showModal();
          }
          $('diagnostics').textContent=JSON.stringify({...metadata,bytes,result},null,2);
        }catch(e){if(mode==='record')continueGame();status('记录不能导出：'+e.message+'；可以继续游玩。');}finally{busy=false;update();}
      },
    }});
    core.onError=failure;core.onExit=()=>{close();status('游戏核心已退出。');};
    if(cheat())core.setReplayCheat(true);
    if($('bgm-volume'))core.bgm?.setVolume(Number($('bgm-volume').value)/100);
    status(playback?'正在载入关卡，随后由游戏播放 Replay…':'等待进入关卡 · 菜单和演示不记录，音乐由浏览器独立播放。');canvas.focus();
  }catch(e){failure(e);}finally{busy=false;update();}
}
function updateFast(){
  const active=controls.size&&dialog&&core&&!paused&&!(result&&mode==='playback')&&!$('save-dialog').open&&!document.hidden;
  if(active&&!fastTimer){
    const pulse=()=>{fastPulse=!fastPulse;key(90,held.has('KeyZ'));};
    pulse();fastTimer=setInterval(pulse,100);
  }else if(!active&&fastTimer){clearInterval(fastTimer);fastTimer=null;fastPulse=false;key(90,held.has('KeyZ'));}
}
for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
  if(['ControlLeft','ControlRight'].includes(event.code)){
    if(type==='keyup')controls.delete(event.code);
    else if(core&&!(result&&mode==='playback')&&!event.target?.closest?.('input,select,button'))controls.add(event.code);
    updateFast();return;
  }
  if($('save-dialog').open||$('end-dialog').open)return;
  if(mode==='playback'&&core&&!result&&['Escape','Space'].includes(event.code)&&!event.target?.closest?.('input,select,button')){event.preventDefault();if(type==='keydown'&&!event.repeat)togglePause();return;}
  if(!(event.code in keys)||event.ctrlKey||event.metaKey||event.altKey||event.target?.closest?.('input,select,button'))return;
  if(!core)return;event.preventDefault();if((result&&mode==='playback')||busy||$('save-dialog').open)return;
  const before=held.has(event.code);if(type==='keydown')held.add(event.code);else held.delete(event.code);
  if(keys[event.code]===340){key(340,held.has('ShiftLeft')||held.has('ShiftRight'));return;}
  if(before!==(type==='keydown'))key(keys[event.code],type==='keydown');
});
function releaseKeys(){for(const code of new Set([...held].map(name=>keys[name])))key(code,false);held.clear();}
function release(){controls.clear();updateFast();releaseKeys();for(const code of sentKeys)core?.key(code,false);sentKeys.clear();}
window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});window.addEventListener('pagehide',close);
$('record').onclick=()=>{loaded=null;start();};$('finish').onclick=()=>core?.finishReplay();
$('play').onclick=async()=>{try{await start(loaded||await decodeFrameReplay(recording));}catch(e){failure(e);}};
$('file').onchange=async()=>{try{const file=$('file').files[0];if(!file)return;loaded=await decodeFrameReplay(file);recording=null;$('test-case').value=loaded.header.testProfile||'';status(`已导入${loaded.header.testProfile?'结算流程测试录像':'录像'} · ${loaded.header.frames} 帧，可由游戏播放。`);update();}catch(e){loaded=null;failure(e);}};
function download(){if(!recording||tainted||cheat())return;const url=URL.createObjectURL(recording),a=document.createElement('a');a.href=url;a.download=metadata?.testProfile?`th05-test-${metadata.testProfile}.th05r`:'th05-solo.th05r';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('download').onclick=download;
function continueGame(){
  $('save-dialog').close();store?.dispose();store=null;paused=false;
  core?.pauseReplay(false);$('canvas').focus();update();
}
$('save-replay').onclick=()=>{download();continueGame();status('录像已请求下载，可以继续游玩；下一局自动开始录制。');};
$('discard-replay').onclick=()=>{recording=null;continueGame();status('本局录像已丢弃，可以继续游玩；下一局自动开始录制。');};$('save-dialog').addEventListener('cancel',e=>e.preventDefault());
function togglePause(){if(!core||mode!=='playback'||result||busy)return;release();paused=!paused;core.pauseReplay(paused);$('hold').textContent=paused?'继续播放':'暂停播放';$('canvas').focus();}
$('hold').onclick=togglePause;
$('replay-again').onclick=()=>$('play').onclick();
$('end-replay').onclick=()=>{close();status('Replay 已结束，可以导入其他文件或启动游戏。');};
$('end-dialog').addEventListener('cancel',event=>{event.preventDefault();$('end-replay').click();});
$('stop').onclick=()=>{close();status('模拟器已关闭。');};
if($('invincible'))$('invincible').onchange=setCheat;
if($('restart'))$('restart').onclick=()=>{loaded=null;start();};
if($('pause'))$('pause').onclick=()=>{release();if(mode==='playback')togglePause();else core?.gamePause();$('canvas').focus();};
if($('fullscreen'))$('fullscreen').onclick=()=>{const target=$('game-stage');if(document.fullscreenElement)document.exitFullscreen();else target?.requestFullscreen().catch(error=>status(error.message));};
if($('sound'))$('sound').onclick=()=>core?.audio?.resume();
if($('bgm-volume'))$('bgm-volume').oninput=()=>core?.bgm?.setVolume(Number($('bgm-volume').value)/100);
if($('capture'))$('capture').onclick=async()=>{if(!core)return;try{const url=URL.createObjectURL(await core.capture()),a=document.createElement('a');a.href=url;a.download='th05-solo.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status(e.message);}};
for(const button of document.querySelectorAll('[data-native-key]')){
  const code=Number(button.dataset.nativeKey);
  button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);key(code,true);};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>key(code,false));
}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&core){release();if(mode==='playback'&&!paused&&!result)togglePause();else if(mode==='record')core.gamePause({onlyPause:true});}});
setInterval(()=>{if(core&&(mode==='record'||!result))$('diagnostics').textContent=JSON.stringify({mode,bytes,state:core.readState(),music:core.bgm?.status,musicError:core.musicError},null,2);},500);
if(new URLSearchParams(location.search).get('qa')==='1')window.th05ReplayQA={
  start:()=>start(),key,finish:()=>core?.finishReplay(),read:()=>({mode,bytes,result,run,tainted,hasRecording:!!recording,hasStore:!!store,savePrompt:$('save-dialog').open,state:core?.readState(),music:core?.bgm?.status,musicError:core?.musicError}),
  exportBase64:async()=>{const data=new Uint8Array(await recording.arrayBuffer());let text='';for(let i=0;i<data.length;i+=32768)text+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(text);},
  play:async()=>start(await decodeFrameReplay(recording)),close,
};
update();
