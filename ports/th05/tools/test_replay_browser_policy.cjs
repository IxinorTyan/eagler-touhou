// Real browser and normal solo boot; no listeners or instrumented QA adapter.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),base='http://127.0.0.1:9877';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={date:new Date().toISOString(),requests:[],errors:[]};
 try{
  const context=await browser.newContext();
  await context.route(base+'/**',route=>{
   const name=decodeURIComponent(new URL(route.request().url()).pathname);report.requests.push(name);
   const file=path.resolve(web,'.'+name);
   if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});
  });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{
   // Playwright file routing cannot serve AudioWorklet fetches without a listener.
   globalThis.AudioWorkletNode=undefined;
   const NativeWorker=Worker;window.coreBoots=[];window.coreStates=[];
   window.Worker=class extends NativeWorker{
    constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='state')coreStates.push(data.state);});}
    postMessage(data,...rest){if(data.type==='boot')coreBoots.push({frameReplay:!!data.frameReplay,externalReplay:!!data.externalReplay,qa:!!data.qa,solo:!!data.solo});return super.postMessage(data,...rest);}
   };
  });
  await page.goto(base+'/solo-original.html');await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('运行中')||document.querySelector('#status').textContent.includes('失败'),null,{timeout:60000});
  report.soloStatus=await page.locator('#status').innerText();assert.match(report.soloStatus,/原版单人运行中/);
  report.boots=await page.evaluate(()=>coreBoots);assert.deepEqual(report.boots,[{frameReplay:false,externalReplay:false,qa:false,solo:true}]);
  await page.waitForFunction(()=>coreStates.some(s=>s?.frames>0),null,{timeout:20000});
  report.soloState=await page.evaluate(()=>coreStates.at(-1));assert(!report.soloState.frameReplay);report.audioScope='existing buffer fallback; AudioWorklet network path not exercised';
  assert.equal(await page.locator('#file').count(),0,'normal solo must not offer the retired replay overlay');
  await page.goto(base+'/solo-replay.html');assert.match(await page.locator('h1').innerText(),/单人 Replay/);
  report.guards=await page.evaluate(async()=>{
   const {createFastCore}=await import('/dosbox-runtime.js'),results={};
   try{await createFastCore({frameReplay:{mode:'record'}});results.frameReplay='allowed';}catch(e){results.frameReplay=e.message;}
   for(const [name,url,extra]of [['stage','/lan-worker.js',{stageObservation:true}],['frameWorker','/dosbox-worker.js',{frameReplay:{mode:'record'}}]]){
    results[name]=await new Promise((resolve,reject)=>{const w=new Worker(url,{type:name==='stage'?'module':'classic'});const timer=setTimeout(()=>{w.terminate();reject(Error('guard timeout'));},10000);w.onmessage=({data})=>{if(data.type==='error'){clearTimeout(timer);w.terminate();resolve(data.message);}};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message));};w.postMessage({type:'boot',...extra});});
   }
   return results;
  });
  assert.match(report.guards.stage,/正式入口已停用/);assert.match(report.guards.frameReplay,/仅允许播放/);assert.match(report.guards.frameWorker,/仅允许播放/);
  report.specialRequests=report.requests.filter(name=>/(?:patch-stage-|th05-stage-|stage-runtime|wdosbox-x-stage|frame-replay-(?:core|ending|cn|jp)|\/frame-replay\.json)/.test(name));
  assert.deepEqual(report.specialRequests,[]);assert.deepEqual(report.errors,[]);report.passed=true;
  console.log('PASS ordinary solo boot, no replay assets, DOS recording overlays rejected by runtime and Worker');
 }finally{fs.writeFileSync(path.join(root,'reports/replay-browser-policy.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
