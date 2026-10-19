import {createFastCore,prepareFastCore} from './dosbox-runtime.js';
import {loadVerifiedBytes} from './startup-assets.js';
import {sha256} from './netplay/sha256.js';
import {HOST_VERSION} from './external-replay-host.js';
import {encodeReplay,decodeReplay} from './external-replay-codec.js';
import {createReplayStore} from './external-replay-store.js';
const $=id=>document.getElementById(id),held=new Set();
const keys={ArrowUp:265,ArrowDown:264,ArrowLeft:263,ArrowRight:262,KeyX:88,KeyZ:90,ShiftLeft:340,ShiftRight:340,Escape:256,Enter:257};
let core=null,mode=null,busy=false,store=null,events=[],bytes=0,metadata=null,result=null,loaded=null,recording=null,paused=false,run=null;
const status=text=>{$('status').textContent=text;};
const dependencies=['external-replay-host.js','external-replay-codec.js','dosbox-runtime.js','dosbox-worker.js','disk-files.js','solo-input.js','frame-presenter.js','sidebar-background.js','game-locator.js','personal-hud.js','native-players.js','native-touch.js','touch-input.js'];
async function resources(language){
  const [diskManifest,runtime,...sources]=await Promise.all([
    fetch('solo-disks.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('磁盘清单读取失败');return r.json();}),
    fetch('vendor/dosbox-x/runtime.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('核心清单读取失败');return r.json();}),
    ...dependencies.map(async name=>{const r=await fetch(name,{cache:'no-store'});if(!r.ok)throw Error('适配器读取失败');return [name,await sha256(new Uint8Array(await r.arrayBuffer()))];}),
  ]);
  const item=diskManifest.languages[language];if(!item?.inputPatch)throw Error('单人输入接口缺失');
  const identity=await sha256(new TextEncoder().encode(JSON.stringify({item,files:runtime.files,sources,version:HOST_VERSION})));
  const disk=await loadVerifiedBytes(new URL(item.url,import.meta.url),item.sha256,{gzip:true,size:item.size});
  return {disk,patch:item.inputPatch,identity};
}
function update(){
  $('record').disabled=busy||!!core;$('finish').disabled=busy||mode!=='record'||!run||!!result;
  $('download').disabled=busy||!recording;$('play').disabled=busy||!(loaded||recording);
  $('hold').disabled=busy||mode!=='playback'||!!result;$('stop').disabled=busy||!core;
  $('file').disabled=busy||!!core;$('language').disabled=busy||!!core;
}
function close(){core?.stop();core=null;store?.dispose();store=null;held.clear();mode=null;paused=false;run=null;$('save-dialog').close();$('hold').textContent='暂停播放';update();}
function failure(error){close();busy=false;status('实验停止：'+error.message);update();}
function key(code,down){if(mode!=='record'||result||!core)return;core.key(code,down);}
async function start(playback=null){
  if(busy)return;busy=true;close();result=null;if(!playback)recording=null;events=[];bytes=0;
  mode=playback?'playback':'record';const language=playback?.header.language||$('language').value;
  $('language').value=language;status('准备单人游戏与浏览器侧记录器…');update();
  try{
    const coreTask=prepareFastCore();coreTask.catch(()=>{});
    const {disk,patch,identity}=await resources(language),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    if(playback&&(playback.header.identity!==identity||playback.header.timeZone!==timeZone))throw Error('录像与当前游戏／宿主适配器版本或时区不一致');
    metadata={version:HOST_VERSION,mode:'solo',language,independentMusic:false,identity,timeZone,userAgent:navigator.userAgent};
    if(!playback)store=createReplayStore(failure);
    const canvas=document.createElement('canvas');canvas.id='canvas';canvas.width=640;canvas.height=400;canvas.tabIndex=0;canvas.style.cssText=$('canvas').style.cssText;canvas.setAttribute('aria-label','TH05 单人 Replay 实验画面');$('canvas').replaceWith(canvas);
    core=await createFastCore({canvas,disk,patch,solo:true,independentMusic:false,coreTask,externalReplay:{
      mode,clocks:playback?.clocks?.slice(),events:playback?.header.events,endBoundary:playback?.header.result.boundary,
      onRun:started=>{run=started;status(mode==='record'?'已进入关卡，正在录制本局 · 退出本局后将询问是否保存。':'正在回放关卡 · 真人输入已隔离。');update();},
      onChunk:data=>{
        if(data.clocks){bytes+=data.clocks.length;store?.add(data.clocks);}
        if(data.events)events.push(...data.events);
      },
      onEnd:async ended=>{
        if(mode==='record'){
          busy=true;update();
          try{const compressed=await store.finish();recording=await encodeReplay({...metadata,events,result:ended},compressed);status(`本局录制已结束 · ${(recording.size/1024).toFixed(1)} KiB，请选择是否保存。`);$('save-size').textContent=`本局录像 ${(recording.size/1024).toFixed(1)} KiB。保存后可导入回放。`;$('save-dialog').showModal();}catch(e){status('记录不能导出：'+e.message);}finally{busy=false;}
        }else{
          const matches=ended.guestSha256===playback.header.result.guestSha256&&ended.guestHash===playback.header.result.guestHash;
          status(matches?`回放完成 · 输入、时钟已完整消费，最终游戏内存校验一致 (${ended.guestHash})。`:`回放失步 · 最终校验 ${ended.guestHash} ≠ ${playback.header.result.guestHash}`);
          ended.matches=matches;
        }
        result=ended;
        $('diagnostics').textContent=JSON.stringify({...metadata,bytes,result},null,2);update();
      },
    }});
    core.onError=failure;core.onExit=()=>{close();status('模拟器已退出。');};
    status(playback?'正在重建录像的启动流程 · 真人输入已隔离。':'等待进入关卡 · 开始游戏后自动录制本局，演示播放不会开始一局录像。');canvas.focus();
  }catch(error){failure(error);}finally{busy=false;update();}
}
for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
  if(!(event.code in keys)||event.ctrlKey||event.metaKey||event.altKey||event.target?.closest?.('input,select,button'))return;
  if(!core)return;event.preventDefault();if(mode!=='record'||result)return;
  const before=held.has(event.code);
  if(type==='keydown')held.add(event.code);else held.delete(event.code);
  // Both physical Shift keys share one guest key.
  if(keys[event.code]===340){key(340,held.has('ShiftLeft')||held.has('ShiftRight'));return;}
  if(before!==(type==='keydown'))key(keys[event.code],type==='keydown');
});
function release(){for(const code of new Set([...held].map(name=>keys[name])))key(code,false);held.clear();}
window.addEventListener('blur',release);
document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
window.addEventListener('pagehide',close);
$('record').onclick=()=>{loaded=null;start();};
$('finish').onclick=()=>{if(core&&mode==='record'){core.finishReplay();$('finish').disabled=true;status('正在模拟器让出执行的边界结束录制…');}};
$('play').onclick=async()=>{try{const data=loaded||await decodeReplay(recording);await start(data);}catch(e){failure(e);}};
$('file').onchange=async()=>{try{const file=$('file').files[0];if(!file)return;loaded=await decodeReplay(file);recording=null;status(`已导入 ${loaded.header.language==='cn'?'汉化':'日文'}单人录像，可开始回放。`);update();}catch(e){loaded=null;failure(e);}};
function download(){if(!recording)return;const url=URL.createObjectURL(recording),a=document.createElement('a');a.href=url;a.download='th05-solo-external.th05r';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('download').onclick=download;
$('save-replay').onclick=()=>{download();close();status('录像已生成并请求下载，可重新开始游戏或回放本局。');};
$('discard-replay').onclick=()=>{recording=null;close();status('本局录像已丢弃，可重新开始游戏。');};
$('save-dialog').addEventListener('cancel',event=>event.preventDefault());
$('hold').onclick=()=>{paused=!paused;core?.pauseReplay(paused);$('hold').textContent=paused?'继续播放':'暂停播放';};
$('stop').onclick=()=>{close();status('模拟器已关闭。');};
setInterval(()=>{if(core&&!result)$('diagnostics').textContent=JSON.stringify({mode,bytes,state:core.readState()},null,2);},500);
if(new URLSearchParams(location.search).get('qa')==='1')window.th05ReplayQA={
  start:()=>start(),key,finish:()=>core?.finishReplay(),read:()=>({mode,bytes,result,run,savePrompt:$('save-dialog').open,state:core?.readState()}),
  exportBuffer:async()=>Array.from(new Uint8Array(await recording.arrayBuffer())),
  exportBase64:async()=>{const data=new Uint8Array(await recording.arrayBuffer());let text='';for(let i=0;i<data.length;i+=32768)text+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(text);},
  play:async()=>start(await decodeReplay(recording)),
  load:async bytes=>{loaded=await decodeReplay(new Blob([new Uint8Array(bytes)]));},
  playLoaded:()=>start(loaded),close,
};
update();
