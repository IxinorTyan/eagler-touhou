import {packHistoryRows,historyStride,validateHistoryHeader} from './confirmed-history.js';
import {PROTOCOL} from './protocol.js';
const encode=bytes=>btoa(String.fromCharCode(...bytes));
function decode(text){
  if(typeof text!=='string'||text.length>16000)throw Error('旁观批次越界');
  return Uint8Array.from(atob(text),c=>c.charCodeAt(0));
}
async function jsonRequest(url,options){
  const response=await fetch(url,{cache:'no-store',...options});
  if(!response.ok){
    // Proxies commonly return HTML for 502/503. Classify the HTTP status
    // before decoding an optional error body so transient failures reconnect.
    const data=await response.json().catch(()=>null);
    const error=Error(typeof data?.error==='string'?data.error:`旁观连接失败（HTTP ${response.status}）`);
    error.permanent=response.status>=400&&response.status<500;error.transient=response.status>=500;throw error;
  }
  return response.json();
}
// The transport owns no emulator, input sampling or file recording. At most
// one upload is outstanding; the existing bounded history is the send queue.
export function publishNetworkHistory(identity,history,{onLink=()=>{},onStatus=()=>{}}={}){
  const auth={protocol:PROTOCOL,room:identity.room,token:identity.token,generation:identity.generation};
  let watch=null,prefix=0,busy=false,closed=false,finished=false,timer=0,retries=0,upload=null,retryAt=0;
  const abort=new AbortController();
  const post=(action,extra)=>jsonRequest('/api/history-'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...auth,...extra}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
  function schedule(delay){clearTimeout(timer);if(!closed&&!finished)timer=setTimeout(pump,delay);}
  async function pump(){
    if(busy||closed||finished)return;busy=true;
    try{
      if(!watch){
        const data=await post('open',{header:history.header});if(closed)return;
        if(typeof data.watch!=='string'||!/^[A-Za-z0-9_-]{32,80}$/.test(data.watch)||!Number.isInteger(data.frames)||data.frames>history.frames)throw Error('旁观发布身份响应无效');
        watch=data.watch;prefix=data.frames;
        const url=new URL('../coop-replay.html',import.meta.url);url.hash='watch='+watch;onLink(url.href);
      }
      if(upload||prefix<history.frames){
        if(!upload){
          const stop=Math.min(prefix+60,history.frames),rows=[];
          for(let frame=prefix;frame<stop;frame++)rows.push(history.row(frame));
          upload={first:prefix,stop,payload:encode(packHistoryRows(rows,history.header.players))};
        }
        // Keep the exact payload until acknowledged, even if new frames arrive.
        const data=await post('push',{watch,first:upload.first,payload:upload.payload});
        if(data.frames!==upload.stop)throw Error('旁观上传确认帧不一致');prefix=upload.stop;upload=null;
      }else if(history.end){
        const end=await post('end',{watch,...history.end});
        if(end.frames!==prefix)throw Error('旁观结束确认不一致');finished=true;onStatus('跨设备旁观片段已结束');return;
      }else{
        const data=await post('push',{watch,first:prefix,payload:''});
        if(data.frames!==prefix)throw Error('旁观发布前缀不一致');
      }
      retries=0;retryAt=0;onStatus(`跨设备旁观已上传 ${prefix} 帧`);
      schedule(prefix<history.frames||history.end?0:2000);
    }catch(error){
      if(closed)return;
      if(error.permanent){finished=true;onStatus('跨设备旁观停止：'+error.message);}
      else {const delay=Math.min(8000,500*2**Math.min(4,retries++));retryAt=performance.now()+delay;onStatus('旁观上传暂断，保留帧并重试：'+error.message);schedule(delay);}
    }finally{busy=false;}
  }
  function interrupt(){
    if(!watch||finished||closed)return;
    navigator.sendBeacon('/api/history-interrupt',new Blob([JSON.stringify({...auth,watch})],{type:'application/json'}));
  }
  addEventListener('pagehide',interrupt);schedule(0);
  return {kick(){if(!busy)schedule(Math.max(0,retryAt-performance.now()));},close(){interrupt();closed=true;clearTimeout(timer);abort.abort();removeEventListener('pagehide',interrupt);}};
}

// A failed response leaves the receive cursor unchanged. Retry from exactly
// that frame; duplicates and gaps cannot enter the playback archive.
export function receiveNetworkHistory(watch,{onMessage,onStatus=()=>{},onError=()=>{}}){
  let closed=false,timer=0,prefix=0,header=null,bootstrap=null,started=false,retries=0;
  const abort=new AbortController();
  function schedule(delay){clearTimeout(timer);if(!closed)timer=setTimeout(pump,delay);}
  async function pump(){
    try{
      const data=await jsonRequest('/api/history?'+new URLSearchParams({watch,from:String(prefix)}),{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
      if(closed)return;
      validateHistoryHeader(data.header);
      if(!Number.isInteger(data.frames)||data.frames<0||data.frames>216000||data.first!==prefix||data.frames<prefix)throw Error('旁观接收前缀无效');
      if(!header){header=data.header;bootstrap=data.frames;onMessage({type:'begin',header});}
      else if(JSON.stringify(data.header)!==JSON.stringify(header))throw Error('旁观开局身份发生变化');
      const bytes=decode(data.payload),stride=historyStride(header.players),count=bytes.length/stride;
      if(!Number.isInteger(count)||count>300||prefix+count>data.frames||(!count&&prefix<data.frames))throw Error('旁观输入缺帧');
      for(let at=0;at<count;at+=60){const end=Math.min(at+60,count);onMessage({type:'batch',first:prefix+at,bytes:bytes.slice(at*stride,end*stride)});}
      prefix+=count;
      if(!started&&prefix>=bootstrap){started=true;onMessage({type:'bootstrap',frames:prefix});}
      if(data.end&&prefix===data.frames){
        if(data.end.frames!==prefix||typeof data.end.reason!=='string'||data.end.reason.length>250)throw Error('旁观结束边界不一致');
        onMessage({type:'end',...data.end});closed=true;return;
      }
      retries=0;
      if(data.interrupted)onStatus('旁观来源暂时中断，已收帧保留；正在等待续接。');
      schedule(prefix<data.frames?0:250);
    }catch(error){
      if(closed)return;
      if(error.permanent||(!error.transient&&!['TypeError','AbortError','TimeoutError'].includes(error.name))){
        closed=true;onError(error);return;
      }
      onStatus('旁观连接暂断，按原帧号重连…');schedule(Math.min(8000,500*2**Math.min(4,retries++)));
    }
  }
  schedule(0);return {close(){closed=true;clearTimeout(timer);abort.abort();}};
}
