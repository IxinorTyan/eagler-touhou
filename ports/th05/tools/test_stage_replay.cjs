// Independent real instances, isolated init markers and HTTP resource routing.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),probe=path.join(root,'build/stage-replay-probe'+(process.env.TH05_STAGE_TRACE==='1'?'-trace':'')),base='http://127.0.0.1:9877';
const language=process.env.TH05_LANGUAGE||'cn',stage=Number(process.env.TH05_STAGE||1),count=Number(process.env.TH05_STAGE_STEPS||1200),players=Number(process.env.TH05_PLAYERS||2),pattern=process.env.TH05_STAGE_PATTERN==='1';
const characters=(process.env.TH05_STAGE_CHARACTERS||Array.from({length:players},(_,n)=>n).join(',')).split(',').map(Number);
const viewerWarm=Number(process.env.TH05_STAGE_VIEWER_WARM_STEPS||0);
assert(['cn','jp'].includes(language)&&[2,3].includes(players));
assert(Number.isInteger(stage)&&stage>=1&&stage<=5,'fixture currently covers main-game stages 2 through 6');
assert(Number.isInteger(count)&&count>=600&&count<=12000);
assert(characters.length===players&&characters.every(n=>Number.isInteger(n)&&n>=0&&n<=3));
assert(Number.isInteger(viewerWarm)&&viewerWarm>=0&&viewerWarm<=1200);
const harness=`<script type="module">
let worker,waiting=new Map();
const ask=data=>new Promise((resolve,reject)=>{waiting.set(data.type==='boot'?'ready':'stage-probe-result',{resolve,reject});worker.postMessage(data);});
window.fixture={async boot(language){worker=new Worker('/lan-worker.js',{type:'module'});worker.onmessage=({data})=>{
 if(data.type==='frame'){data.bitmap.close();worker.postMessage({type:'frame-ack',seq:data.seq});return;}
 if(data.type==='error'){for(const w of waiting.values())w.reject(Error(data.message));waiting.clear();return;}
 const w=waiting.get(data.type);if(w){waiting.delete(data.type);w.resolve(data);}
 };worker.onerror=e=>{for(const w of waiting.values())w.reject(Error(e.message));};
 return ask({type:'boot',settings:{language,rollback:false},config:{rank:1,players:${JSON.stringify(characters.map(character=>({character,spares:3,bombs:3}))) }},viewSlot:0});},
 ask:args=>ask({type:'stage-probe',...args})};</script>`;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const corrupt=process.env.TH05_STAGE_CORRUPT_INPUT==='1';
 const report={schema:2,language,players,characters,pattern,stage,count,viewerWarm,corrupt,scope:'QA-triggered native stage transition; compact scalar initialization experiment; not production stage playback',errors:[]};
 report.resources=Object.fromEntries([
   ['diskManifest',path.join(probe,'web/patch-'+language+'.json')],
   ['core',path.join(root,'build/stage-replay-probe/probe.wasm')],
   ['productionWorker',path.join(web,'lan-worker.js')],
   ['probeWorker',path.join(__dirname,'stage_replay_probe_worker.js')],
   ['stateSchema',path.join(__dirname,'stage_replay_probe_state.mjs')],
   ['fixture',__filename],
 ].map(([name,file])=>[name,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
 try{
 const context=await browser.newContext();
 await context.route(base+'/**',async route=>{
  const name=new URL(route.request().url()).pathname;
  if(name==='/fixture.html')return route.fulfill({body:harness,contentType:'text/html'});
  if(name==='/probe.wasm')return route.fulfill({path:path.join(root,'build/stage-replay-probe/probe.wasm'),contentType:'application/wasm'});
  if(name==='/stage-probe-state.mjs')return route.fulfill({path:path.join(__dirname,'stage_replay_probe_state.mjs'),contentType:'text/javascript'});
  if(name==='/lan-worker.js'){
   let body=fs.readFileSync(path.join(web,'lan-worker.js'),'utf8');
   body=body.replace(/    loadCompiledCore[^\n]+/,'    WebAssembly.compile(await(await fetch("/probe.wasm")).arrayBuffer()),');
   body=body.replace('new WebAssembly.Instance(compiledCore,imports)','new WebAssembly.Instance(compiledCore,{...imports,env:{...imports.env,th05_stage:stageMarker}})');
   return route.fulfill({body:body+'\n'+fs.readFileSync(path.join(__dirname,'stage_replay_probe_worker.js'),'utf8'),contentType:'text/javascript'});
  }
  const file=/^\/(patch-(cn|jp)\.json|th05-local-(cn|jp)\.hdi\.gz)$/.test(name)?path.join(probe,'web',name.slice(1)):path.resolve(web,'.'+name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});
 });
 const source=await context.newPage(),viewer=await context.newPage();
 for(const page of [source,viewer]){page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/fixture.html');await page.waitForFunction(()=>window.fixture);}
 report.sourceBoot=await source.evaluate(l=>fixture.boot(l),language);console.log('source booted');
 await source.evaluate(()=>fixture.ask({action:'run',count:617,keys:32}));
 await source.evaluate(({stage,pattern})=>fixture.ask({action:'jump',stage,pattern}),{stage,pattern});
 report.source=await source.evaluate(count=>fixture.ask({action:'run',count}),count);console.log('source samples',report.source.samples.length);
 const descriptor=structuredClone(report.source.captured);assert.equal(descriptor.stage,stage);
 const inputs=pattern?structuredClone(report.source.inputs):null;
 if(corrupt){assert(inputs?.length>1);inputs[0][0]^=12;}
 report.viewerBoot=await viewer.evaluate(l=>fixture.boot(l),language);console.log('fresh viewer booted');
 if(viewerWarm)await viewer.evaluate(count=>fixture.ask({action:'run',count,keys:0}),viewerWarm);
 await viewer.evaluate(({restore,stage,pattern,inputs})=>fixture.ask({action:'jump',stage,restore,pattern,inputs}),{restore:descriptor,stage,pattern,inputs});
 report.viewer=await viewer.evaluate(count=>fixture.ask({action:'run',count}),count);console.log('viewer samples',report.viewer.samples.length);
 const a=report.source.samples,b=report.viewer.samples,compared=Math.min(a.length,b.length);
 report.descriptorBytes=descriptor.bytes.length;
 report.firstMismatch=null;
 for(let n=0;n<compared;n++)if(JSON.stringify(a[n])!==JSON.stringify(b[n])){report.firstMismatch={index:n,source:a[n],viewer:b[n]};break;}
 report.compared=compared;
 report.activeWorld={maxBullets:Math.max(...a.map(s=>s.activeBullets)),maxEnemies:Math.max(...a.map(s=>s.activeEnemies))};
 assert(compared>=300,'must compare substantial native stage execution');
 if(corrupt)assert(report.firstMismatch&&report.firstMismatch.index<=2,'recorded input corruption must diverge immediately');
 else assert.equal(report.firstMismatch,null,'compact stage initialization diverged');
 assert.deepEqual(report.errors,[]);
 report.passed=true;console.log('PASS',corrupt?'recorded input corruption detected':'independent stage rebuild',compared,'native updates',report.descriptorBytes,'bytes');
 }finally{fs.writeFileSync(path.join(root,'reports/stage-replay-probe-v2-'+language+'-'+players+'-'+stage+(pattern?'-pattern':'')+(corrupt?'-corrupt':'')+(process.env.TH05_STAGE_TRACE==='1'?'-trace':'')+'.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
