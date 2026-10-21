import {publishNetworkHistory} from './history-network.js';
import {ConfirmedHistory,historySessionId} from './confirmed-history.js';
import {createReplayStore} from '../external-replay-store.js';
import {encodeMultiplayerReplay} from './history-codec.js';
import {createCheckpointBuilder} from '../checkpoint-builder.js';
// Browser-owned history feeds independent file, local-channel and optional
// HTTP publishers. BroadcastChannel remains same-browser only; the current
// server transport does not imply main-project lobby integration.
export function createHistoryHost(header,{record=true,watch=true,checkpoints=true,onChange=()=>{},onError=()=>{}}={}){
  const history=new ConfirmedHistory(header),id=historySessionId(),channel=watch?new BroadcastChannel('th05-history-'+id):null;
  let tainted=false,recordEpoch=0;
  let store=record?createReplayStore(failRecord):null,recordFrames=0,blob=null,sealing=null,closed=false,recordError=null;
  const requests=new Map();let network=null,networkURL=null,networkStatus='',watchTimer=0;
  let builder=null,checkpointChain=Promise.resolve(),resolveBuilder;
  const builderDone=new Promise(resolve=>resolveBuilder=resolve);
  function checkpointError(error){history.checkpoints.failed=error.message;history.checkpointsDone=true;builder?.terminate();builder=null;resolveBuilder();onChange();network?.kick();}
  if(checkpoints&&(record||watch))try{
    builder=createCheckpointBuilder();
    builder.onmessage=({data})=>{
      if(closed)return;
      if(data.type==='checkpoint'){
        checkpointChain=checkpointChain.then(async()=>{
          if(history.checkpoints.failed)return;
          if(data.identity!==header.identity||data.frame>history.frames)throw Error('后台检查点身份或帧数无效');
          await history.checkpoints.append(data);network?.kick();onChange();
        }).catch(checkpointError);
      }
      if(data.type==='error')checkpointChain.then(()=>checkpointError(Error(data.message)));
      if(data.type==='done')checkpointChain.then(()=>{history.checkpointsDone=true;builder?.terminate();builder=null;resolveBuilder();network?.kick();onChange();});
    };
    builder.postMessage({type:'boot',header});
  }catch(error){checkpointError(error);}
  else{history.checkpointsDone=true;resolveBuilder();}
  function failRecord(error){recordError=error;store?.dispose();store=null;recordFrames=0;blob=null;onError(error);onChange();}
  function post(message,to){channel?.postMessage({...message,to});}
  function scheduleWatch(delay=0){
    if(!channel||closed||!requests.size)return;
    if(watchTimer&&delay!==0)return;
    clearTimeout(watchTimer);watchTimer=setTimeout(pumpWatch,delay);
  }
  function pumpWatch(){
    watchTimer=0;if(closed)return;const now=performance.now();
    for(const [viewer,state]of requests){
      const revision=history.checkpoints.entries.length+':'+history.checkpointsDone;
      if(state.indexRevision!==revision){post({type:'checkpoint-index',entries:history.checkpoints.index(),done:history.checkpointsDone},viewer);state.indexRevision=revision;}
      if(state.ended)continue;
      if(state.waiting!==null){
        if(now-state.sentAt>15000){post({type:'interrupted',reason:'本机旁观接收积压，已停止发送；玩家游戏继续'},viewer);requests.delete(viewer);}continue;
      }
      // Each viewer owns at most one unacknowledged batch (<=60 frames).
      // Never clone an entire match into a sleeping tab's message queue.
      if(!state.bootstrapped&&state.frame===state.bootstrap){post({type:'bootstrap',frames:state.frame},viewer);state.bootstrapped=true;}
      const batch=history.batches[state.index];
      if(batch){state.waiting=batch.first+batch.bytes.length/(header.players*8+13);state.sentAt=now;post({type:'batch',...batch,stageFrames:history.stages.frames(batch.first,state.waiting-batch.first)},viewer);}
      else if(history.end){post({type:'end',...history.end},viewer);state.ended=true;}
    }
    scheduleWatch(1000);
  }
  if(channel)channel.onmessage=({data})=>{
    if(closed||typeof data?.viewer!=='string'||!/^[a-f0-9-]{36}$/.test(data.viewer))return;
    const state=requests.get(data.viewer);
    if(data.type==='checkpoint-get'&&state&&Number.isInteger(data.frame)){
      const entry=history.checkpoints.entries.find(e=>e.frame===data.frame);
      if(entry)post({type:'checkpoint-data',request:data.request,...entry},data.viewer);return;
    }
    if(data.type==='unsubscribe'){requests.delete(data.viewer);return;}
    if(data.type==='ack'){
      if(state&&state.waiting!==null&&data.frames===state.waiting){state.frame=data.frames;state.index++;state.waiting=null;clearTimeout(watchTimer);watchTimer=0;scheduleWatch();}return;
    }
    if(data.type!=='subscribe'||state||requests.size>=8)return;
    requests.set(data.viewer,{frame:0,index:0,bootstrap:history.frames,bootstrapped:false,waiting:null,sentAt:0});
    post({type:'begin',header:history.header},data.viewer);clearTimeout(watchTimer);watchTimer=0;scheduleWatch();
  };
  function invalidate(){if(tainted)return;tainted=true;recordEpoch++;store?.dispose();store=null;blob=null;recordFrames=0;onChange();}
  function seal(reason='手动结束录制'){
    if(tainted)return Promise.reject(Error('本局使用过作弊辅助，不保存 Replay'));
    if(sealing)return sealing;
    if(!store||!recordFrames)return Promise.reject(recordError||Error('尚无已确认输入可导出'));
    const current=store;store=null;const frames=recordFrames,epoch=recordEpoch,stageRecords=history.stages.export(frames);
    sealing=current.finish().then(async compressed=>{
      // Only file finalization waits; player input never awaits this replica.
      if(history.end){let timeout;try{await Promise.race([builderDone,new Promise(resolve=>{timeout=setTimeout(resolve,30000);})]);}finally{clearTimeout(timeout);}}await checkpointChain;
      return encodeMultiplayerReplay({...history.header,frames,reason:String(reason).slice(0,250)},compressed,stageRecords,history.checkpoints.entries.filter(e=>e.frame<=frames));
    })
      .then(file=>{if(tainted||epoch!==recordEpoch)throw Error('本局录像已作废');blob=file;onChange();return file;}).catch(error=>{failRecord(error);throw error;});
    sealing.catch(()=>{});return sealing;
  }
  return {
    id,history,invalidate,get tainted(){return tainted;},get blob(){return blob;},get recording(){return !!store;},get recordFrames(){return recordFrames;},
    append(first,bytes,stageFrames){
      const batch=history.append(first,bytes,stageFrames);
      if(builder){const copy=batch.bytes.slice();builder.postMessage({type:'append',first,bytes:copy},[copy.buffer]);}
      if(history.tainted)invalidate();
      scheduleWatch();
      if(store&&store.add(batch.bytes.slice()))recordFrames=history.frames;
      network?.kick();onChange();
    },
    seal,
    get watch(){return watch;},
    async snapshot(){
      if(tainted)throw Error('本局使用过作弊辅助，不保存 Replay');
      const epoch=recordEpoch;
      if(history.end)return blob||seal(history.end.reason);
      if(!store||!recordFrames)throw recordError||Error('尚无已确认输入可导出');
      // Copy a fixed confirmed prefix on demand; the live recorder keeps running.
      const frames=recordFrames,count=history.batches.length,stageRecords=history.stages.export(recordFrames),copy=createReplayStore(()=>{});let sliceBytes=0;
      try{
        for(let index=0;index<count;index++){
          if(closed||tainted||epoch!==recordEpoch)throw Error('本局录像已作废或关闭');
          const batch=history.batches[index];
          if(!copy.add(batch.bytes.slice()))throw Error('录像导出压缩已停止');
          sliceBytes+=batch.bytes.length;
          if(sliceBytes>=16384||copy.pendingChunks>=64){await copy.drain();await new Promise(resolve=>setTimeout(resolve,0));sliceBytes=0;}
        }
        const file=await encodeMultiplayerReplay({...history.header,frames,reason:'途中导出的已确认片段'},await copy.finish(),stageRecords,history.checkpoints.entries.filter(e=>e.frame<=frames));
        if(tainted||epoch!==recordEpoch)throw Error('本局录像已作废');return file;
      }finally{copy.dispose();}
    },
    discard(){store?.dispose();store=null;blob=null;recordFrames=0;onChange();},
    get networkURL(){return networkURL;},get networkStatus(){return networkStatus;},
    connectNetwork(identity){if(!watch||closed||network)return;network=publishNetworkHistory(identity,history,{onLink:url=>{networkURL=url;onChange();},onStatus:value=>{networkStatus=value;onChange();}});},
    end(reason){
      builder?.postMessage({type:'end'});
      if(!history.end){history.finish(reason);scheduleWatch();}
      if(store&&recordFrames)seal(reason);else if(store){store.dispose();store=null;}network?.kick();onChange();
    },
    dispose(){network?.close();closed=true;builder?.terminate();builder=null;resolveBuilder();clearTimeout(watchTimer);requests.clear();channel?.close();store?.dispose();store=null;},
  };
}
