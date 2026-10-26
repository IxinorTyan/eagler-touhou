/* Receive complete owned images. Keep simulation off the page, but present on
 * the page's refresh clock rather than the busy simulation worker's clock. */
export function createFrameDisplay(canvas,{release,onError}) {
  let bitmap;
  try{bitmap=canvas.getContext('bitmaprenderer',{alpha:false});}catch{bitmap=null;}
  const context=bitmap||canvas.getContext('2d',{alpha:false});
  if(!context)throw Error('浏览器无法创建游戏画面');
  const metrics={mode:'bitmap',renderer:bitmap?'bitmaprenderer':'2d',received:0,presented:0,
    discarded:0,expired:0,hiddenDiscarded:0,sequenceGaps:0,lastSequence:0,
    queued:0,maxQueued:0,maxTransportMs:0,lastLatencyMs:0,maxLatencyMs:0,totalLatencyMs:0};
  const queue=[];let stopped=false,raf=0,lastReceived=0;
  const now=()=>performance.timeOrigin+performance.now();
  function dispose(frame,reason){
    frame.bitmap.close();metrics.discarded++;
    if(reason==='expired')metrics.expired++;
    if(reason==='hidden')metrics.hiddenDiscarded++;
    release(frame.seq,false);metrics.queued=queue.length;
  }
  function clear(reason='hidden'){while(queue.length)dispose(queue.shift(),reason);}
  function receive(frame){
    if(stopped){frame.bitmap.close();return;}
    metrics.received++;
    if(frame.seq<=lastReceived){dispose(frame,'invalid');onError(Error('游戏画面顺序异常'));return;}
    lastReceived=frame.seq;
    metrics.maxTransportMs=Math.max(metrics.maxTransportMs,now()-frame.producedAt);
    if(document.hidden){dispose(frame,'hidden');return;}
    // Simulation can finish several steps between screen refreshes. Display
    // the newest complete image, releasing superseded transfers immediately.
    clear('superseded');
    queue.push(frame);
    metrics.queued=queue.length;metrics.maxQueued=Math.max(metrics.maxQueued,queue.length);
  }
  function paint(){
    if(stopped)return;
    raf=requestAnimationFrame(paint);
    try{
      if(document.hidden){clear();return;}
      const time=now();
      while(queue.length&&time-queue[0].producedAt>50)dispose(queue.shift(),'expired');
      if(!queue.length)return;
      const frame=queue.shift();metrics.queued=queue.length;
      try{
        if(canvas.width!==frame.width||canvas.height!==frame.height){canvas.width=frame.width;canvas.height=frame.height;}
        if(bitmap)bitmap.transferFromImageBitmap(frame.bitmap);
        else{context.imageSmoothingEnabled=false;context.drawImage(frame.bitmap,0,0);}
        if(metrics.lastSequence)metrics.sequenceGaps+=frame.seq-metrics.lastSequence-1;
        metrics.lastSequence=frame.seq;metrics.presented++;
        const latency=Math.max(0,time-frame.producedAt);
        metrics.lastLatencyMs=latency;metrics.totalLatencyMs+=latency;metrics.maxLatencyMs=Math.max(metrics.maxLatencyMs,latency);
        release(frame.seq,true);
      }finally{frame.bitmap.close();}
    }catch(e){onError(e);}
  }
  const lost=()=>onError(Error('游戏画面上下文已丢失，请重新开始'));
  canvas.addEventListener('contextlost',lost);raf=requestAnimationFrame(paint);
  return {metrics,receive,clear,
    capture:()=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('画面保存失败')),'image/png')),
    stop(){if(stopped)return;stopped=true;cancelAnimationFrame(raf);clear('stopped');canvas.removeEventListener('contextlost',lost);}};
}
