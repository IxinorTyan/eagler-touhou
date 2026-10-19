export function createReplayStore(onError){
  const worker=new Worker(new URL('./external-replay-store-worker.js',import.meta.url));
  const chunks=[];let resolve,reject,done=false,compressedBytes=0;
  const finished=new Promise((a,b)=>{resolve=a;reject=b;});finished.catch(()=>{});
  function fail(error){if(done)return;done=true;worker.terminate();reject(error);onError(error);}
  worker.onerror=event=>fail(Error(event.message));
  worker.onmessage=({data})=>{
    if(data.type==='chunk'){chunks.push(data.bytes);compressedBytes+=data.bytes.byteLength;}
    if(data.type==='finished'){done=true;resolve({chunks,rawBytes:data.rawBytes,compressedBytes});worker.terminate();}
    if(data.type==='error')fail(Error(data.message));
  };
  worker.postMessage({type:'init'});
  return {add(bytes){if(!done)worker.postMessage({type:'chunk',bytes},[bytes.buffer]);},finish(){if(!done)worker.postMessage({type:'finish'});return finished;},
    dispose(){if(!done){done=true;worker.terminate();reject(Error('记录存储已关闭'));}}};
}
