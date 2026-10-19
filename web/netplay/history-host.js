import {publishNetworkHistory} from './history-network.js';
import {ConfirmedHistory,historySessionId} from './confirmed-history.js';
import {createReplayStore} from '../external-replay-store.js';
import {encodeMultiplayerReplay} from './history-codec.js';
// Browser-owned history feeds independent file, local-channel and optional
// HTTP publishers. BroadcastChannel remains same-browser only; the current
// server transport does not imply main-project lobby integration.
export function createHistoryHost(header,{record=true,onChange=()=>{},onError=()=>{}}={}){
  const history=new ConfirmedHistory(header),id=historySessionId(),channel=new BroadcastChannel('th05-history-'+id);
  let store=record?createReplayStore(failRecord):null,recordFrames=0,blob=null,sealing=null,closed=false,recordError=null;
  const requests=new Map();let network=null,networkURL=null,networkStatus='';
  function failRecord(error){recordError=error;store?.dispose();store=null;onError(error);onChange();}
  function post(message,to){channel.postMessage({...message,to});}
  channel.onmessage=({data})=>{
    if(closed||data?.type!=='subscribe'||typeof data.viewer!=='string'||!/^[a-f0-9-]{36}$/.test(data.viewer))return;
    const now=performance.now(),last=requests.get(data.viewer);
    if((last!==undefined&&now-last<2000)||(!requests.has(data.viewer)&&requests.size>=8))return;
    requests.set(data.viewer,now);
    post({type:'begin',header:history.header},data.viewer);
    for(const batch of history.batches)post({type:'batch',...batch},data.viewer);
    post({type:'bootstrap',frames:history.frames},data.viewer);
    if(history.end)post({type:'end',...history.end},data.viewer);
  };
  function seal(reason='手动结束录制'){
    if(sealing)return sealing;
    if(!store||!recordFrames)return Promise.reject(recordError||Error('尚无已确认输入可导出'));
    const current=store;store=null;const frames=recordFrames;
    sealing=current.finish().then(compressed=>encodeMultiplayerReplay({...history.header,frames,reason:String(reason).slice(0,250)},compressed))
      .then(file=>{blob=file;onChange();return file;}).catch(error=>{failRecord(error);throw error;});
    sealing.catch(()=>{});return sealing;
  }
  return {
    id,history,get blob(){return blob;},get recording(){return !!store;},get recordFrames(){return recordFrames;},
    append(first,bytes){
      const batch=history.append(first,bytes);
      post({type:'batch',...batch});
      if(store){store.add(bytes.slice());recordFrames=history.frames;}
      network?.kick();onChange();
    },
    seal,
    get networkURL(){return networkURL;},get networkStatus(){return networkStatus;},
    connectNetwork(identity){network=publishNetworkHistory(identity,history,{onLink:url=>{networkURL=url;onChange();},onStatus:value=>{networkStatus=value;onChange();}});},
    end(reason){
      if(!history.end){history.finish(reason);post({type:'end',...history.end});}
      if(store&&recordFrames)seal(reason);else if(store){store.dispose();store=null;}network?.kick();onChange();
    },
    dispose(){network?.close();closed=true;channel.close();store?.dispose();store=null;},
  };
}
