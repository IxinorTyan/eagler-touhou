// Browser storage/compression worker. No access to emulator memory or DOS FS.
let writer,reader,reading,chain=Promise.resolve(),rawBytes=0,closed=false;
function fail(error){closed=true;postMessage({type:'error',message:error.message});}
onmessage=({data})=>{
  if(closed)return;
  if(data.type==='init'){
    const stream=new CompressionStream('gzip');writer=stream.writable.getWriter();reader=stream.readable.getReader();
    reading=(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;postMessage({type:'chunk',bytes:value},[value.buffer]);}})();
    reading.catch(fail);return;
  }
  if(data.type==='chunk'){
    rawBytes+=data.bytes.byteLength;
    if(rawBytes>120*1024*1024){fail(Error('时钟记录超过实验容量，请缩短录制'));return;}
    chain=chain.then(()=>writer.write(data.bytes));chain.catch(fail);return;
  }
  if(data.type==='finish'){
    closed=true;
    chain.then(()=>writer.close()).then(()=>reading).then(()=>postMessage({type:'finished',rawBytes})).catch(fail);
  }
};
