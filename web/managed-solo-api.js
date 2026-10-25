const managedReplayWrites=new Set();
async function managedSaveReplay(blob){
  const task=globalThis.__eaglerPC98Files.write('replay/th05_'+Date.now()+'_'+crypto.randomUUID().slice(0,8)+'.th05r',await blob.arrayBuffer());
  managedReplayWrites.add(task);try{await task;}catch(error){globalThis.__eaglerPC98Emit({event:'error',message:'录像保存失败：'+error.message});}finally{managedReplayWrites.delete(task);}
}
async function managedNaturalExit(){
  const deadline=performance.now()+10000;
  while(recorder?.state.ending&&!recorder.state.ready&&!recorder.state.failed&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  await Promise.allSettled([...managedReplayWrites]);globalThis.__eaglerPC98Emit({event:'exit',code:0});
}
export const managedAPI={
  async start({language,music,options}){
    if(options.replayPath)throw Error('此接入入口尚未启用录像播放');
    $('language').value=language==='ja'?'jp':'cn';$('record-enabled').checked=true;
    await start({practiceConfig:null});if(!emulator)throw Error($('status').textContent);
    if(music==='none')emulator.bgm?.setVolume(0);player.enter();
  },
  health(){return {frames:emulator?.readState()?.presentation?.presented??0,audio:{state:emulator?.audio?.state}};},
  async files(message){if(['sync','list','read'].includes(message.command)&&emulator)await emulator.exportUserFiles();return globalThis.__eaglerPC98FileCommands(message);},
  playback(){throw Error('此接入入口尚未启用录像播放');},
  stop(){disposed=true;release();discardRetry();activeAttempt?.stop();clearRecorder();emulator?.stop();},
};
