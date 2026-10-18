// A display-only copy of the exact verified WASM module. It never steps the
// simulation, receives input, emits sound or participates in synchronization.
let core,context,image;
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      core=(await WebAssembly.instantiate(data.module,{})).exports;
      const canvas=new OffscreenCanvas(640,400);
      context=canvas.getContext('2d',{alpha:false});
      if(!context)throw Error('OffscreenCanvas 2D unavailable');
      image=new ImageData(new Uint8ClampedArray(core.memory.buffer,core.th_pixels(),640*400*4),640,400);
      self.postMessage({type:'ready'});return;
    }
    if(data.type!=='render'||!core||data.snapshot.byteLength!==core.memory.buffer.byteLength)throw Error('Invalid display snapshot');
    const started=performance.now();
    new Uint8Array(core.memory.buffer).set(new Uint8Array(data.snapshot));
    core.th_render();context.putImageData(image,0,0);
    const bitmap=context.canvas.transferToImageBitmap(),cost=performance.now()-started;
    self.postMessage({type:'frame',frame:data.frame,snapshot:data.snapshot,bitmap,cost},[data.snapshot,bitmap]);
  }catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
};
