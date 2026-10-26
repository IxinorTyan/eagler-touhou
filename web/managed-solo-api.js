import {mountManagedPractice} from './pc98-practice.mjs';
const managedReplayWrites=new Set();
const managedSavedReplays = new WeakMap();
async function managedSaveReplay(blob) {
  if (managedSavedReplays.has(blob)) return managedSavedReplays.get(blob);
  const pending = (async () => {
    const path = 'replay/th05_' + Date.now() + '_' + crypto.randomUUID().slice(0,8) + '.th05r';
    await globalThis.__eaglerPC98Files.write(path, await blob.arrayBuffer());
    return path;
  })();
  managedSavedReplays.set(blob, pending); managedReplayWrites.add(pending);
  try { return await pending; }
  catch (error) { managedSavedReplays.delete(blob); globalThis.__eaglerPC98Emit({event:'error',message:'录像保存失败：'+error.message}); }
  finally { managedReplayWrites.delete(pending); }
}
async function managedNaturalExit(){
  const deadline=performance.now()+10000;
  while(recorder?.state.ending&&!recorder.state.ready&&!recorder.state.failed&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  await Promise.allSettled([...managedReplayWrites]);globalThis.__eaglerPC98Emit({event:'exit',code:0});
}
export const managedAPI={
  practiceState:()=>({...managedPractice.state(),retry:{state:retrySlot?(retrySlot.ready?'ready':'preparing'):retryBlocked?'unavailable':'idle',last:lastRetry}}),
  async start({language,music,options}){
    if(options.replayPath)throw Error('此接入入口尚未启用录像播放');
    $('language').value=language==='ja'?'jp':'cn';$('record-enabled').checked=true;
    $('bgm-volume').value=music==='none'?'0':'70';
    await start({practiceConfig:null});if(!emulator)throw Error($('status').textContent);
    if(music==='none')emulator.bgm?.setVolume(0);player.enter();managedPractice.start();
  },
  health(){return {frames:emulator?.readState()?.presentation?.presented??0,audio:{state:emulator?.audio?.state}};},
  async files(message){if(['sync','list','read'].includes(message.command)&&emulator)await emulator.exportUserFiles();return globalThis.__eaglerPC98FileCommands(message);},
  playback(){throw Error('此接入入口尚未启用录像播放');},
  stop(){managedPractice.stop();disposed=true;release();discardRetry();activeAttempt?.stop();clearRecorder();emulator?.stop();},
};

const managedPractice=mountManagedPractice(practiceUI,globalThis.__eaglerPC98Input,{release,readState:()=>emulator?.readState()});

$('record-save').onclick=async()=>{if(!recordBlob)return;const path=await managedSaveReplay(recordBlob);if(path)$('record-save').textContent='已存入主项目录像';};
