import {createFastCore,prepareFastCore} from './dosbox-runtime.js';
import {loadVerifiedBytes} from './startup-assets.js';
import {decodeReplay} from './external-replay-codec.js';
import {browserReplayIdentity} from './browser-replay-recorder.js';
const $=id=>document.getElementById(id);
let core=null,loaded=null,result=null,busy=false,paused=false,epoch=0;
const status=text=>{$('status').textContent=text;};
function update(){
  $('play').disabled=busy||!loaded;$('hold').disabled=busy||!core||!!result;
  $('stop').disabled=busy||!core;$('file').disabled=busy;
}
function close(){epoch++;core?.stop();core=null;paused=false;$('hold').textContent='暂停播放';update();}
async function play(){
  if(busy||!loaded)return;close();const owner=epoch;busy=true;result=null;update();
  status('正在重建录像启动流程，菜单和剧情自动播放…');
  try{
    const language=loaded.header.language;
    const [identity,response]=await Promise.all([browserReplayIdentity(language),fetch('solo-disks.json',{cache:'no-store'})]);
    if(!response.ok)throw Error('磁盘清单读取失败');
    if(identity!==loaded.header.identity||Intl.DateTimeFormat().resolvedOptions().timeZone!==loaded.header.timeZone)throw Error('录像与当前资源版本或时区不一致');
    const item=(await response.json()).languages[language],coreTask=prepareFastCore(!!loaded.header.practice);coreTask.catch(()=>{});
    const disk=await loadVerifiedBytes(new URL(item.url,import.meta.url),item.sha256,{gzip:true,size:item.size});
    if(loaded.header.practice){const response=await fetch('practice-assets.json',{cache:'no-store'});if(!response.ok)throw Error('练习资源缺失');const p=(await response.json()).languages[language];if(p.sourceMainSha256!==item.inputPatch.main_sha256)throw Error('练习资源已过期');item.inputPatch=p.patch;item.practiceExe=await loadVerifiedBytes(new URL(p.url,import.meta.url),p.sha256,{gzip:true,size:p.size});}
    const canvas=$('canvas');canvas.replaceWith(canvas.cloneNode(false));
    const booted=await createFastCore({canvas:$('canvas'),disk,patch:item.inputPatch,solo:true,independentMusic:loaded.header.independentMusic,coreTask,practice:loaded.header.practice,practiceExe:item.practiceExe,externalReplay:{
      mode:'playback',clocks:loaded.clocks.slice(),events:loaded.header.events,endBoundary:loaded.header.result.boundary,
      onEnd:value=>{
        if(owner!==epoch)return;
        result={...value,matches:value.guestSha256===loaded.header.result.guestSha256&&value.guestHash===loaded.header.result.guestHash};
        status(result.matches?'Replay 播放完成，输入、时钟和最终游戏内存校验一致。':'Replay 已停止：最终游戏内存校验不一致。');
        core?.pauseReplay(true);$('diagnostics').textContent=JSON.stringify(result,null,2);update();
      },
    }});
    if(owner!==epoch){booted.stop();return;}core=booted;
    core.onError=error=>{status('播放失败：'+error.message);close();};
    core.onExit=()=>{status('模拟器已退出。');close();};
    if(!result)status('正在播放 Replay，菜单和剧情自动重演。');
  }catch(error){if(owner===epoch){status('播放失败：'+error.message);close();}}finally{busy=false;update();}
}
$('file').onchange=async()=>{
  close();loaded=null;result=null;busy=true;update();
  try{const file=$('file').files[0];if(file){loaded=await decodeReplay(file);status('已导入浏览器录像，可以开始播放。');}}
  catch(error){status('导入失败：'+error.message);}finally{busy=false;update();}
};
$('play').onclick=play;
$('hold').onclick=()=>{if(!core||result)return;paused=!paused;core.pauseReplay(paused);$('hold').textContent=paused?'继续播放':'暂停播放';};
$('stop').onclick=()=>{close();status('播放已关闭。');};
$('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else $('canvas').requestFullscreen().catch(error=>status(error.message));};
$('sound').onclick=()=>core?.audio?.resume();
window.addEventListener('pagehide',close);
setInterval(()=>{if(core&&!result)$('diagnostics').textContent=JSON.stringify(core.readState(),null,2);},500);
if(new URLSearchParams(location.search).get('qa')==='1')window.th05BrowserReplayQA={
  read:()=>({result,state:core?.readState(),busy,paused,status:$('status').textContent}),
  play,close,
};
update();
