export function titlePreview(host){
  let worker,canvas,task,serial=0,rejectCurrent,timeout;
  function stop(){serial++;clearTimeout(timeout);worker?.terminate();worker=null;canvas?.remove();canvas=null;rejectCurrent?.(Error('标题预览已取消'));rejectCurrent=null;task=null;}
  return {stop,prepare(language='ja'){
    if(task)return task;const own=++serial;
    task=(async()=>{
      const {loadVerifiedBytes}=await import('./startup-assets.js');
      const [disks,runtime]=await Promise.all(['solo-disks.json','vendor/dosbox-net/runtime.json'].map(async path=>(await fetch(path)).json()));
      const spec=disks.languages[language==='ja'?'jp':'cn'];
      const [disk,wasmBinary]=await Promise.all([loadVerifiedBytes(new URL(spec.url,import.meta.url),spec.sha256,{gzip:true,size:spec.size}),loadVerifiedBytes(new URL('vendor/dosbox-net/wdosbox-x-rollback.wasm',import.meta.url),runtime.files['wdosbox-x-rollback.wasm'])]);
      if(own!==serial)throw Error('标题预览已取消');
      canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;host.append(canvas);canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated';
      worker=new Worker(new URL('./room-title-worker.js',import.meta.url),{type:'module'});
      await new Promise((resolve,reject)=>{rejectCurrent=reject;timeout=setTimeout(()=>reject(Error('原生标题加载超时')),90000);
        const done=error=>{clearTimeout(timeout);rejectCurrent=null;error?reject(error):resolve();};
        worker.onerror=e=>done(Error(e.message));worker.onmessage=({data})=>{if(data.type==='ready')done();else if(data.type==='error')done(Error(data.message));};
        const offscreen=canvas.transferControlToOffscreen();worker.postMessage({type:'boot',game:'05',managedTitle:true,canvas:offscreen,disk,wasmBinary},[offscreen,disk.buffer,wasmBinary.buffer]);
      });
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(own!==serial)throw Error('标题预览已取消');return {presented:true};
    })().catch(error=>{if(own===serial)stop();throw error;});return task;
  }};
}
