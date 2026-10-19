// Diagnostic only. Adds read-only probes to the Worker response in Playwright,
// leaving production JS/WASM unchanged. No server or listener is started.
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),base='http://127.0.0.1:9877';
const probe=`
const productionMessage=onmessage;
onmessage=async event=>{
 if(!event.data.type.startsWith('analysis-'))return productionMessage(event);
 try{
  if(event.data.type==='analysis-run'){
   const start=performance.now(),from=frame;mod.suppressPresentation=!!event.data.suppress;
   try{for(let n=0;n<event.data.count;n++){
    advance([32|(frame%80<40?4:8),32|(frame%80<40?8:4)],false,0);confirm(frame);
    if(!event.data.suppress)mod.framePresenter.flush();
   }}finally{mod.suppressPresentation=false;}
   send('analysis-result',{from,frame,elapsedMs:performance.now()-start,ticks:state().ticks,checksum:checksum()});return;
  }
  const continuation=mod.captureContinuation(),describe=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,typeof v]));
  let cloneError=null;try{structuredClone(continuation);}catch(error){cloneError=error.name;}
  const copies=[];let memory;
  for(let i=0;i<3;i++){const at=performance.now();memory=mod.HEAPU8.slice();copies.push(performance.now()-at);}
  const gzipAt=performance.now();
  const compressed=await new Response(new Blob([memory]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const gzipMs=performance.now()-gzipAt;
  let usedPages=0;const page=4096;
  for(let at=0;at<memory.length;at+=page){for(let i=at;i<Math.min(at+page,memory.length);i++)if(memory[i]){usedPages++;break;}}
  const nodes=[],seen=new Set();let fileBytes=0;
  const visit=(node,name)=>{if(!node||seen.has(node))return;seen.add(node);
   const functions=Object.entries(node).filter(([,v])=>typeof v==='function').map(([k])=>k);
   const ops=['node_ops','stream_ops'].flatMap(k=>Object.entries(node[k]||{}).filter(([,v])=>typeof v==='function').map(([n])=>k+'.'+n));
   nodes.push({path:name,functions,ops,bytes:node.usedBytes||0});fileBytes+=node.contents?.byteLength||0;
   if(mod.FS.isDir(node.mode))for(const [key,child]of Object.entries(node.contents))visit(child,name+'/'+key);
  };visit(mod.FS.root,'');
  const globalNames=Object.entries(mod.nativeExports()).filter(([name,v])=>name.startsWith('__rollback_g')&&v instanceof WebAssembly.Global).map(([name,v])=>({name,type:typeof v.value}));
  send('analysis-result',{frame,ticks:state().ticks,heapBytes:memory.length,copyMs:copies,heapGzipBytes:compressed.byteLength,heapGzipMs:gzipMs,
   nonzeroPages:usedPages,pageBytes:page,continuationTypes:describe(continuation),continuationCloneError:cloneError,globalNames,
   fs:{fileBytes,nodes,streams:mod.FS.streams.filter(Boolean).map(s=>({fd:s.fd,path:s.path,keys:Object.keys(s),position:s.position}))},
   browserUserAgent:navigator.userAgent});
 }catch(error){send('error',{message:error.message});}
};`;
const harness=`<!doctype html><script>
let worker,pending;
window.rpc=(data,reply)=>new Promise((resolve,reject)=>{pending={reply,resolve,reject};worker.postMessage(data);});
window.boot=()=>{worker=new Worker('/lan-worker.js',{type:'module'});worker.onmessage=({data})=>{
 if(data.type==='frame'){data.bitmap.close();worker.postMessage({type:'frame-ack',seq:data.seq});return;}
 if(data.type==='error'){pending?.reject(Error(data.message));pending=null;return;}
 if(data.type===pending?.reply){pending.resolve(data);pending=null;}
 };return rpc({type:'boot',settings:{language:'cn',rollback:false},viewSlot:0,config:{rank:1,players:[{character:0,spares:5,bombs:3},{character:1,spares:5,bombs:3}]}},'ready');};
</script>`;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const context=await browser.newContext();await context.route(base+'/**',async route=>{
   const name=new URL(route.request().url()).pathname;
   if(name==='/analysis.html')return route.fulfill({body:harness,contentType:'text/html'});
   const file=path.resolve(web,'.'+name);
   if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   if(name==='/lan-worker.js')return route.fulfill({body:fs.readFileSync(file,'utf8')+probe,contentType:'text/javascript'});
   const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm'};
   return route.fulfill({path:file,contentType:types[path.extname(file)]||'application/octet-stream'});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/analysis.html');await page.waitForFunction(()=>window.boot);await page.evaluate(()=>boot());
  const rpc=data=>page.evaluate(data=>rpc(data,'analysis-result'),data),report={scope:'CN two-player ordinary core; diagnostic injection; no server; stage-one short sample'};
  // Interleave windows: distinct scenes/JIT/GC mean these are observations,
  // not an isolated causal measurement of rendering overhead.
  report.windows=[];
  for(const suppress of [false,true,false,true])report.windows.push({...await rpc({type:'analysis-run',count:180,suppress}),suppress});
  report.state=await rpc({type:'analysis-state'});
  // A second fresh core executes every numbered step without display output.
  // Compare each window's native checksum, rather than comparing different
  // scenes to claim rendering speedup.
  const fresh=await context.newPage();fresh.on('pageerror',e=>errors.push(e.message));
  await fresh.goto(base+'/analysis.html');await fresh.waitForFunction(()=>window.boot);await fresh.evaluate(()=>boot());
  report.freshSuppressed=[];
  for(const expected of report.windows){
   const actual=await fresh.evaluate(()=>rpc({type:'analysis-run',count:180,suppress:true},'analysis-result'));
   assert.equal(actual.frame,expected.frame);assert.equal(actual.ticks,expected.ticks);assert.equal(actual.checksum,expected.checksum);
   report.freshSuppressed.push(actual);
  }
  report.errors=errors;
  assert.equal(report.state.continuationTypes.pendingWake,'function');assert.equal(report.state.continuationCloneError,'DataCloneError');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(root,'reports/replay-checkpoint-analysis.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({heapBytes:report.state.heapBytes,copyMs:report.state.copyMs,heapGzipBytes:report.state.heapGzipBytes,heapGzipMs:report.state.heapGzipMs,
   continuationCloneError:report.state.continuationCloneError,windows:report.windows},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
