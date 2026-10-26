import {publishNetworkHistory} from './history-network.js';
import {ConfirmedHistory,historySessionId} from './confirmed-history.js';
import {createCheckpointBuilder} from '../checkpoint-builder.js';
// Browser-owned confirmed history feeds local and optional HTTP spectators.
export function createHistoryHost(header,{watch=true,checkpoints=true,onChange=()=>{}}={}){
  const history=new ConfirmedHistory(header),id=historySessionId(),channel=watch?new BroadcastChannel('th05-history-'+id):null;
  let tainted=false,closed=false;
  const requests=new Map();let network=null,networkURL=null,networkStatus='',watchTimer=0;
  let builder=null,checkpointChain=Promise.resolve();
  function checkpointError(error){history.checkpoints.failed=error.message;history.checkpointsDone=true;builder?.terminate();builder=null;onChange();network?.kick();}
  if(checkpoints&&watch)try{
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
      if(data.type==='done')checkpointChain.then(()=>{history.checkpointsDone=true;builder?.terminate();builder=null;network?.kick();onChange();});
    };
    builder.postMessage({type:'boot',header});
  }catch(error){checkpointError(error);}
  else history.checkpointsDone=true;
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
  function invalidate(){if(tainted)return;tainted=true;onChange();}
  return {
    id,history,invalidate,get tainted(){return tainted;},
    append(first,bytes,stageFrames){
      const batch=history.append(first,bytes,stageFrames);
      if(builder){const copy=batch.bytes.slice();builder.postMessage({type:'append',first,bytes:copy},[copy.buffer]);}
      if(history.tainted)invalidate();
      scheduleWatch();
      network?.kick();onChange();
    },
    get watch(){return watch;},
    get networkURL(){return networkURL;},get networkStatus(){return networkStatus;},
    connectNetwork(identity){if(!watch||closed||network)return;network=publishNetworkHistory(identity,history,{onLink:url=>{networkURL=url;onChange();},onStatus:value=>{networkStatus=value;onChange();}});},
    end(reason){
      builder?.postMessage({type:'end'});
      if(!history.end){history.finish(reason);scheduleWatch();}
      network?.kick();onChange();
    },
    dispose(){network?.close();closed=true;builder?.terminate();builder=null;clearTimeout(watchTimer);requests.clear();channel?.close();},
  };
}
