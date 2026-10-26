import {sha256} from './netplay/sha256.js';
import {HOST_VERSION} from './external-replay-host.js';
import {encodeReplay,MAX_CLOCK_BYTES,MAX_EVENT_BYTES} from './external-replay-codec.js';
import {createReplayStore} from './external-replay-store.js';

export async function browserReplayIdentity(language){
  const names=['solo-disks.json','vendor/dosbox-x/runtime.json','external-replay-host.js','external-replay-codec.js',
    'dosbox-runtime.js','dosbox-worker.js','disk-files.js','solo-input.js','game-locator.js','native-players.js',
    'native-touch.js','touch-input.js','frame-presenter.js','sidebar-background.js','personal-hud.js',
    'practice-config.js','practice-engine.js','practice-assets.json','practice-core.json',
    'music-files.js','music-patch.json','solo-native-music.js'];
  const sources=await Promise.all(names.map(async name=>{
    const response=await fetch(new URL(name,import.meta.url),{cache:'no-store'});
    if(!response.ok)throw Error('浏览器 Replay 资源身份读取失败');
    return [name,await sha256(new Uint8Array(await response.arrayBuffer()))];
  }));
  return sha256(new TextEncoder().encode(JSON.stringify({version:HOST_VERSION,language,sources})));
}

export async function createBrowserRecorder({language,practice,independentMusic=false,onStatus=()=>{},onFile=()=>{},onRun=()=>{},onResult=()=>{}}){
  const identity=await browserReplayIdentity(language);
  let core=null,store=null,failed=false,disposed=false,ending=false,events=[],eventBytes=2,bytes=0,run=null,result=null,file=null;
  const metadata={version:HOST_VERSION,mode:'solo',language,independentMusic,identity,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  if(practice)metadata.practice=structuredClone(practice);
  function fail(error){
    if(failed||disposed)return;failed=true;file=null;events=[];store?.dispose();store=null;core?.stopBrowserRecording();
    onStatus('录像已停止：'+error.message+'；游戏继续。重新启动游戏后可重新录制。');
  }
  store=createReplayStore(fail,{maxRawBytes:MAX_CLOCK_BYTES});
  const config={mode:'record',
    onRun:value=>{if(failed||disposed)return;run=value;onRun(value);onStatus('浏览器正在录制本次启动；退出本局时可保存，也可提前结束录制。');},
    onChunk:chunk=>{
      if(failed||disposed)return;
      if(chunk.clocks){bytes+=chunk.clocks.length;if(!store.add(chunk.clocks))return;}
      if(chunk.events){eventBytes+=new TextEncoder().encode(JSON.stringify(chunk.events)).length;
        if(eventBytes>MAX_EVENT_BYTES){fail(Error('输入记录超过容量'));return;}events.push(...chunk.events);}
    },
    onRecordingError:fail,
    onEnd:async value=>{
      if(failed||disposed||ending)return;ending=true;result=value;onResult(value);
      onStatus('本次录制结束，正在浏览器内生成录像；游戏可继续操作。');
      try{
        const compressed=await store.finish();if(disposed||failed)return;
        const blob=await encodeReplay({...metadata,events,result:value},compressed);if(disposed||failed)return;
        file=blob;events=[];store=null;onFile(blob,value);
        onStatus('录像已就绪，可保存或丢弃；游戏继续。再次录制请重新启动游戏。');
      }catch(error){fail(error);}
    },
  };
  return {config,attach(value){core=value;if(failed)core.stopBrowserRecording();},finish(){if(run&&!failed&&!ending)core?.finishReplay();},
    disable:()=>fail(Error('本局使用了不限速辅助，不保存 Replay')),
    dispose(){disposed=true;core?.stopBrowserRecording();store?.dispose();events=[];file=null;},
    get state(){return {bytes,run,result,failed,ending,ready:!!file};},get file(){return file;}};
}
