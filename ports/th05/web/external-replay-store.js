// Compression is optional work: bound queued transfers and stop recording
// instead of ever waiting on this worker from the simulation/input path.
export function createReplayStore(onError=()=>{},{maxPendingBytes=256*1024,maxPendingChunks=128,maxCompressedBytes=128*1024*1024,maxRawBytes=120*1024*1024,stallMs=15000}={}){
  let worker=null;
  const chunks=[],pending=new Map(),waiters=[];let resolve,reject,done=false,ending=false,compressedBytes=0,pendingBytes=0,serial=0,timer=0,error=null;
  const finished=new Promise((a,b)=>{resolve=a;reject=b;});finished.catch(()=>{});
  function settle(){if(pendingBytes&&!done)return;for(const waiter of waiters.splice(0))error?waiter.reject(error):waiter.resolve();}
  function arm(){clearTimeout(timer);timer=0;if(pendingBytes||ending)timer=setTimeout(()=>fail(Error('录像压缩处理超时，已停止录制；游戏继续')),stallMs);}
  function fail(reason,notify=true){if(done)return;error=reason;done=true;clearTimeout(timer);worker?.terminate();pending.clear();pendingBytes=0;chunks.length=0;reject(reason);settle();if(notify)onError(reason);}
  function message({data}){
    if(done)return;
    if(data.type==='consumed'){
      const size=pending.get(data.id);if(size===undefined){fail(Error('录像压缩确认无效'));return;}
      pending.delete(data.id);pendingBytes-=size;arm();settle();
    }
    if(data.type==='chunk'){
      compressedBytes+=data.bytes.byteLength;
      if(compressedBytes>maxCompressedBytes){fail(Error('录像压缩数据超过容量，已停止录制；游戏继续'));return;}
      chunks.push(data.bytes);
    }
    if(data.type==='finished'){
      if(pending.size){fail(Error('录像压缩缺少确认'));return;}
      done=true;clearTimeout(timer);resolve({chunks,rawBytes:data.rawBytes,compressedBytes});settle();worker.terminate();
    }
    if(data.type==='error')fail(Error(data.message));
  }
  try{
    worker=new Worker(new URL('./external-replay-store-worker.js',import.meta.url));
    worker.onerror=event=>fail(Error(event.message));worker.onmessage=message;worker.postMessage({type:'init',maxRawBytes});
  }catch(e){queueMicrotask(()=>fail(e));}
  return {
    get pendingBytes(){return pendingBytes;},
    get pendingChunks(){return pending.size;},
    add(bytes){
      if(done||ending||!worker)return false;
      if(pendingBytes+bytes.byteLength>maxPendingBytes||pending.size>=maxPendingChunks){fail(Error('录像压缩积压超过容量，已停止录制；游戏继续'));return false;}
      const id=++serial;pending.set(id,bytes.byteLength);pendingBytes+=bytes.byteLength;
      if(!timer)arm();
      try{worker.postMessage({type:'chunk',id,bytes},[bytes.buffer]);}catch(e){fail(e);return false;}return true;
    },
    // Only an optional export task may wait for compression, never the game.
    drain(){if(error)return Promise.reject(error);if(!pendingBytes)return Promise.resolve();return new Promise((resolve,reject)=>waiters.push({resolve,reject}));},
    finish(){if(!done&&!ending&&worker){ending=true;try{worker.postMessage({type:'finish'});arm();}catch(e){fail(e);}}return finished;},
    dispose(){fail(Error('记录存储已关闭'),false);},
  };
}
