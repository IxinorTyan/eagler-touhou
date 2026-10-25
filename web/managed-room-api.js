// Appended to the source LAN module: its deterministic queue remains in charge.
export const managedAPI={
  async start({options,language,music}) {
    globalThis.Module??={};Module.eaglerOptions=options;
    const count=options.netplayPlayerCount,local=options.netplayPlayer;
    if(![2,3].includes(count)||!Number.isInteger(local)||local<0||local>=count||options.netplaySpectator)throw Error('需要已落座的主项目房间');
    const url=new URL(options.netplayUrl),runId=Number(url.searchParams.get('run')),loadouts=options.netplayLoadouts;
    if(!Number.isSafeInteger(runId)||runId<1||!url.searchParams.get('room'))throw Error('房间开局身份无效');
    if(!Array.isArray(loadouts)||loadouts.length!==count||loadouts.some(l=>!Number.isInteger(l.character)||l.character<0||l.character>3||l.shot!==0))throw Error('机体选择无效');
    const rank=options.netplayDifficulty;if(!Number.isInteger(rank)||rank<0||rank>4)throw Error('难度无效');
    auth={role:roles[local],room:url.searchParams.get('room'),generation:[url.searchParams.get('room'),runId,url.searchParams.get('runtimeGeneration')].join(':'),runId};
    room={phase:'loading',generation:auth.generation,runId,revision:1,network:'public-rtc',transport:'rtc',settings:{players:count,rank,spares:2,bombs:3,language:language==='ja'?'jp':'cn',rollback:options.netplayAdonisMode===0},
      characters:Object.fromEntries(roles.map((r,i)=>[r,loadouts[i]?.character??0])),slots:{host:0,guest:1,guest2:2},present:{host:true,guest:true,guest2:count===3},ready:{host:true,guest:true,guest2:count===3}};
    $('history-enabled').checked=false;$('bgm-volume').value=music==='none'?'0':'70';
    player.enter();await ensureAudio();render();await connect();
  },
  async end(reason,success){
    if(managedEnding)return managedEnding;
    managedEnding=(async()=>{
      if(success){try{await managedTransport?.finish();}catch(error){success=false;reason=error.message;}}
      managedAPI.stop();
      if(!success)globalThis.__eaglerPC98Emit({event:'error',message:reason});
      globalThis.__eaglerPC98Emit({event:'exit',code:success?0:1,reason});
    })();return managedEnding;
  },
  health(){
    Object.assign(globalThis,{__eaglerNetplayLanActive:running,__eaglerNetplayLanFrame:queue?.frame??0,__eaglerNetplayLanConfirmed:queue?.confirmed??0,__eaglerNetplayLanRollback:rollbackCount,__eaglerNetplayLanResimulated:resimulated,__eaglerNetplayInputDelayFrames:queue?.active?queue.inputDelay:queue?.lockstepDelay});
    return {frames:display?.metrics.presented??0,audio:{state:context?.state},running,frame:queue?.frame??0,confirmed:queue?.confirmed??0};
  },
  stop(){finishing=true;running=false;epoch++;clearInputs();clearInterval(heartbeat);clearInterval(pollTimer);clearTimeout(timer);clearTimeout(rtcTimeout);clearTimeout(bootTimeout);wakePending=false;wakeToken++;worker?.terminate();worker=null;display?.stop();display=null;audio?.disconnect();audio=null;bgm?.dispose();bgm=null;context?.close().catch(()=>{});context=null;closeTransport();historyHost?.dispose();},
  files:message=>globalThis.__eaglerPC98FileCommands(message),
  playback(){throw Error('多人录像工作台尚未启用');},
};
