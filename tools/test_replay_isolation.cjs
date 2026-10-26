// Optional replay work must fail independently of player simulation.
// Resource routes only; no listening server or production test hooks.
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),report={},errors=[];
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext(),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('http://127.0.0.1:9877/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/isolation.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><p>isolation test</p>'});
  const file=path.resolve(web,'.'+pathname);
  if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({path:file,contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'});
 });
 try{
  await page.goto('http://127.0.0.1:9877/isolation.html');
  report.consumers=await page.evaluate(async()=>{
   const {createReplayStore}=await import('/external-replay-store.js');
   const {createHistoryHost}=await import('/netplay/history-host.js');
   const {packHistoryRows}=await import('/netplay/confirmed-history.js');
   const {publishNetworkHistory}=await import('/netplay/history-network.js');
   const assert=(v,m)=>{if(!v)throw Error(m);},sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const until=async fn=>{for(let n=0;n<200;n++){if(fn())return;await sleep(10);}throw Error('consumer timeout');};
   const header={version:'th05-confirmed-input/1',protocol:'th05-netplay/9',language:'cn',players:2,config:{rank:1,players:[{character:0,spares:3,bombs:3},{character:1,spares:3,bombs:3}]},identity:'a'.repeat(64),coreSha:'b'.repeat(64),diskSha:'c'.repeat(64),guestSha:'d'.repeat(64),checksum:'12345678'};
   const batch=first=>packHistoryRows(Array.from({length:60},(_,i)=>({pair:[32,0],offlineMask:0,ticks:first+i,gameHash:123,nativeHash:0})),2);
   // A non-responsive compressor cannot create an unbounded postMessage queue.
   const RealWorker=Worker;let posted=0,terminated=0;
   globalThis.Worker=class{postMessage(message){if(message.type==='chunk')posted++;}terminate(){terminated++;}};
   let overflow=null;const blocked=createReplayStore(e=>overflow=e,{maxPendingBytes:8,stallMs:100});
   assert(blocked.add(new Uint8Array(8)),'first transfer accepted');
   assert(!blocked.add(new Uint8Array(1)),'overflow must stop, never wait');
   assert(overflow&&posted===1&&terminated===1&&blocked.pendingBytes===0,'bounded queue released');
   let timedOut=null;const stalled=createReplayStore(e=>timedOut=e,{stallMs:25});stalled.add(new Uint8Array(1));
   await until(()=>timedOut);assert(stalled.pendingBytes===0,'stalled worker released');
   globalThis.Worker=class{constructor(){throw Error('worker creation denied');}};
   let unavailable=null;const missing=createReplayStore(e=>unavailable=e);await until(()=>unavailable);
   await missing.finish().then(()=>{throw Error('missing worker must not export');},()=>{});globalThis.Worker=RealWorker;
   // The real gzip protocol acknowledges queued writes and finishes losslessly.
   const store=createReplayStore(e=>{throw e;});const raw=new Uint8Array(40000).map((_,i)=>i%251);
   for(let at=0;at<raw.length;at+=2000)store.add(raw.slice(at,at+2000));
   const zipped=await store.finish(),restored=new Uint8Array(await new Response(new Blob(zipped.chunks).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
   assert(restored.length===raw.length&&restored.every((b,i)=>b===raw[i]),'real compressor round trip');
   // Disabled watching creates no channel or network publisher.
   const RealChannel=BroadcastChannel;let channels=0;
   globalThis.BroadcastChannel=class extends RealChannel{constructor(...args){super(...args);channels++;}};
   const off=createHistoryHost(header,{watch:false});off.append(0,batch(0));off.connectNetwork({});
   assert(channels===0&&!off.networkURL,'watch disabled is inactive');off.dispose();globalThis.BroadcastChannel=RealChannel;
   // Bootstrap of a long archive sends one batch, then waits for viewer ACK.
   const host=createHistoryHost(header);for(let at=0;at<600;at+=60)host.append(at,batch(at));
   const viewer=new BroadcastChannel('th05-history-'+host.id),id='11111111-1111-4111-8111-111111111111';
   let count=0,received=0,bootstrap=null,ended=false,ack=false;
   viewer.onmessage=({data})=>{
    if(data.type==='batch'){assert(data.first===received,'ordered local delivery');received+=data.bytes.length/29;count++;if(ack)viewer.postMessage({type:'ack',viewer:id,frames:received});}
    if(data.type==='bootstrap')bootstrap=data.frames;
    if(data.type==='end')ended=true;
   };
   viewer.postMessage({type:'subscribe',viewer:id});await until(()=>count===1);
   host.append(600,batch(600));await sleep(80);assert(count===1,'sleeping viewer receives at most one batch');
   ack=true;viewer.postMessage({type:'ack',viewer:id,frames:received});host.end('fixture');await until(()=>ended);
   assert(received===660&&bootstrap===600,'bootstrap target and final spectator tail preserved');
   host.dispose();viewer.close();
   // A stuck HTTP uploader retires only itself, preserving source recording.
   const realFetch=fetch,realBeacon=navigator.sendBeacon;let calls=0,status='',aborted=false;
   globalThis.fetch=(url,options)=>{
    calls++;if(String(url).endsWith('history-open'))return Promise.resolve(new Response(JSON.stringify({watch:'w'.repeat(32),frames:0}),{status:200}));
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('aborted','AbortError'));},{once:true}));
   };
   navigator.sendBeacon=()=>true;
   const source={header,frames:0,end:null,row:()=>({pair:[32,0],offlineMask:0,ticks:1,gameHash:123,nativeHash:0})};
   const publisher=publishNetworkHistory({room:'1234',token:'test',generation:1},source,{maxPendingFrames:120,onStatus:s=>status=s});
   await until(()=>calls===2);source.frames=121;publisher.kick();await sleep(20);
   assert(aborted&&status.includes('上传积压')&&source.frames===121,'stuck upload independently aborted');
   publisher.kick();await sleep(20);assert(calls===2,'retired publisher cannot restart');publisher.close();globalThis.fetch=realFetch;navigator.sendBeacon=realBeacon;
   return {compressionQueueBounded:true,compressionRoundTrip:restored.length,watchDisabledChannels:channels,localReceived:received,bootstrap,uploadRetired:true};
  });
  console.log('PASS solo compression isolation, bounded local spectator bootstrap, disabled watching and stuck upload retirement');
  // Real single-player core: fail its compressor, keep playing, then re-record.
  await context.addInitScript(()=>{
   const RealWorker=Worker;globalThis.storageWorkers=[];
   globalThis.Worker=class extends RealWorker{constructor(url,options){super(url,options);if(String(url).includes('external-replay-store-worker'))storageWorkers.push(this);}};
   const add=Worklet.prototype.addModule;Worklet.prototype.addModule=async function(url,options){const r=await fetch(url),blob=URL.createObjectURL(new Blob([await r.text()],{type:'text/javascript'}));try{return await add.call(this,blob,options);}finally{URL.revokeObjectURL(blob);}};
  });
  await page.goto('http://127.0.0.1:9877/solo.html?qa=1');await page.click('#record');
  const read=()=>page.evaluate(()=>th05ReplayQA.read());
  const tap=async code=>{await page.evaluate(c=>th05ReplayQA.key(c,true),code);await page.waitForTimeout(120);await page.evaluate(c=>th05ReplayQA.key(c,false),code);};
  const enter=async()=>{for(let i=0;i<60;i++){if((await read()).run&&!(await read()).recordError)return;await tap(90);await page.waitForTimeout(300);}throw Error('native run did not start');};
  await page.waitForFunction(()=>th05ReplayQA.read().state,null,{timeout:60000});await enter();
  await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.frames>125);
  await page.evaluate(()=>storageWorkers.at(-1).dispatchEvent(new ErrorEvent('error',{message:'injected compressor failure'})));
  await page.waitForFunction(()=>th05ReplayQA.read().recordError&&th05ReplayQA.read().state?.frameReplay.recordingStopped);
  const failed=await read();assert.equal(failed.tainted,false);assert.equal(failed.hasStore,false);
  await page.evaluate(()=>th05ReplayQA.key(263,true));await page.waitForTimeout(600);await page.evaluate(()=>th05ReplayQA.key(263,false));
  const moved=await read();assert(moved.state.x!==failed.state.x,'same native core accepts real movement after compressor failure');assert.equal(moved.savePrompt,false);
  await tap(256);await page.waitForFunction(()=>th05ReplayQA.read().state?.mode===2);await page.waitForTimeout(600);await tap(264);await page.waitForTimeout(300);await tap(257);
  await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.done);await enter();
  await page.waitForFunction(()=>th05ReplayQA.read().hasStore&&!th05ReplayQA.read().recordError&&!th05ReplayQA.read().state?.frameReplay.recordingStopped);
  report.solo={failed,moved,recovered:await read()};assert.deepEqual(errors,[]);
  console.log('PASS real solo compressor failure preserves core, movement and native quit; next run records without cheat');
 }finally{
  report.errors=errors;fs.writeFileSync(path.join(root,'reports/replay-isolation.json'),JSON.stringify(report,null,2));await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
