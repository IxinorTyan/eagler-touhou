// Browser storage/compression worker. No access to emulator memory or DOS FS.
let writer,reader,reading,chain=Promise.resolve(),rawBytes=0,closed=false,maxRawBytes=120*1024*1024;
function fail(error){closed=true;postMessage({type:'error',message:error.message});}
onmessage=({data})=>{
  if(closed)return;
  if(data.type==='init'){
    if(Number.isSafeInteger(data.maxRawBytes)&&data.maxRawBytes>0&&data.maxRawBytes<=512*1024*1024)maxRawBytes=data.maxRawBytes;
    const stream=new CompressionStream('gzip');writer=stream.writable.getWriter();reader=stream.readable.getReader();
    reading=(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;postMessage({type:'chunk',bytes:value},[value.buffer]);}})();
    reading.catch(fail);return;
  }
  if(data.type==='chunk'){
    rawBytes+=data.bytes.byteLength;
    if(rawBytes>maxRawBytes){fail(Error('录像超过容量，已停止录制；游戏继续'));return;}
    chain=chain.then(()=>writer.write(data.bytes)).then(()=>postMessage({type:'consumed',id:data.id}));chain.catch(fail);return;
  }
  if(data.type==='finish'){
    closed=true;
    chain.then(()=>writer.close()).then(()=>reading).then(()=>postMessage({type:'finished',rawBytes})).catch(fail);
  }
};
