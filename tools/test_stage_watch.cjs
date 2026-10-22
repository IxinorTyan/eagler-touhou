// Independent real instances, isolated init markers and HTTP resource routing.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),readline=require('node:readline');
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),probe=path.join(root,'build/stage-watch'),base='http://127.0.0.1:9877';
const language=process.env.TH05_LANGUAGE||'cn',stage=Number(process.env.TH05_STAGE||1),count=Number(process.env.TH05_STAGE_STEPS||1200),players=Number(process.env.TH05_PLAYERS||2),pattern=process.env.TH05_STAGE_PATTERN==='1';
const characters=(process.env.TH05_STAGE_CHARACTERS||Array.from({length:players},(_,n)=>n).join(',')).split(',').map(Number);
const http=process.env.TH05_STAGE_HTTP==='1';
let bridge,requestBridge;
if(http){
 bridge=spawn('python',['tools/test_history_service.py','--bridge'],{cwd:root,stdio:['pipe','pipe','pipe']});
 let serial=0;const waiting=new Map();
 bridge.stderr.on('data',d=>process.stderr.write(d));
 readline.createInterface({input:bridge.stdout}).on('line',line=>{const value=JSON.parse(line);waiting.get(value.id)?.(value);waiting.delete(value.id);});
 requestBridge=(method,url,data)=>new Promise(resolve=>{const id=++serial;waiting.set(id,resolve);bridge.stdin.write(JSON.stringify({id,method,url,data})+'\n');});
}
const rollback=process.env.TH05_STAGE_ROLLBACK==='1';
const dialog=process.env.TH05_STAGE_DIALOG==='1',offline=process.env.TH05_STAGE_OFFLINE==='1';
const controls=process.env.TH05_STAGE_CONTROLS==='1';
const prefix=Number(process.env.TH05_STAGE_PREFIX||617),benchmark=process.env.TH05_STAGE_BENCH==='1';
const diagnostics=process.env.TH05_STAGE_DIAGNOSTICS==='1';
assert(Number.isInteger(prefix)&&prefix>=617&&prefix<=12000);
assert(['cn','jp'].includes(language)&&[2,3].includes(players));
assert(Number.isInteger(stage)&&stage>=1&&stage<=5,'fixture currently covers main-game stages 2 through 6');
assert(Number.isInteger(count)&&count>=600&&count<=12000);
assert(characters.length===players&&characters.every(n=>Number.isInteger(n)&&n>=0&&n<=3));
const harness=`<script type="module">
let worker,waiting=new Map();
const ask=data=>new Promise((resolve,reject)=>{waiting.set(data.type==='boot'?'ready':'stage-probe-result',{resolve,reject});worker.postMessage(data);});
window.fixture={async boot(language,playback=false,collect=true){worker=new Worker('/lan-worker.js',{type:'module'});worker.onmessage=({data})=>{
 if(data.type==='frame'){data.bitmap.close();worker.postMessage({type:'frame-ack',seq:data.seq});return;}
 if(data.type==='error'){window.fixture.lastError=data;for(const w of waiting.values())w.reject(Error(data.message));waiting.clear();return;}
 const w=waiting.get(data.type);if(w){waiting.delete(data.type);w.resolve(data);}
 };worker.onerror=e=>{for(const w of waiting.values())w.reject(Error(e.message));};
 return ask({type:'boot',settings:{language,rollback:playback?false:${rollback}},config:{rank:1,players:${JSON.stringify(characters.map(character=>({character,spares:3,bombs:3}))) }},viewSlot:0,stageObservation:true,captureStages:!playback&&collect,captureHistory:!playback,verifyHistory:playback});},
 ask:args=>ask({type:'stage-probe',...args})};</script>`;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={schema:3,date:new Date().toISOString(),language,players,characters,pattern,rollback,stage,count,controls,prefix,scope:'production Worker stage capture/playback and optional viewer UI; QA-triggered native stage transition',errors:[]};
 try{
 const context=await browser.newContext();
 const routes=context=>context.route(base+'/**',async route=>{
  const url=new URL(route.request().url()),name=url.pathname;
  if(http&&name.startsWith('/api/')){const r=await requestBridge(route.request().method(),name+url.search,route.request().method()==='POST'?route.request().postDataJSON():undefined);return route.fulfill({status:r.status,json:r.body});}
  if(name==='/fixture.html')return route.fulfill({body:harness,contentType:'text/html'});
  if(name==='/probe.wasm')return route.fulfill({path:path.join(root,'web/vendor/dosbox-net/wdosbox-x-stage.wasm'),contentType:'application/wasm'});
  if(name==='/stage-probe-state.mjs')return route.fulfill({path:path.join(__dirname,'../web/netplay/stage-initial.js'),contentType:'text/javascript'});
  if(name==='/lan-worker.js'){
   let body=fs.readFileSync(path.join(web,'lan-worker.js'),'utf8');
   return route.fulfill({body:body+'\n'+fs.readFileSync(path.join(__dirname,'stage_watch_test_worker.js'),'utf8'),contentType:'text/javascript'});
  }
  const file=/^\/(patch-(cn|jp)\.json|th05-local-(cn|jp)\.hdi\.gz)$/.test(name)?path.join(probe,'web',name.slice(1)):path.resolve(web,'.'+name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});
 });
 await routes(context);
 const source=await context.newPage(),viewer=await context.newPage();
 for(const page of [source,viewer]){page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/fixture.html');await page.waitForFunction(()=>window.fixture);}
 report.sourceBoot=await source.evaluate(l=>fixture.boot(l),language);console.log('source booted');
 const prefixSource=await source.evaluate(count=>fixture.ask({action:'run',count,keys:32}),prefix);
 report.prefixSource={checksum:prefixSource.checksum,runMs:prefixSource.runMs,ticks:prefixSource.state.ticks};
 await source.evaluate(({stage,pattern,dialog,diagnostics})=>fixture.ask({action:'jump',stage,pattern,dialog,diagnostics}),{stage,pattern,dialog,diagnostics});
 report.source=await source.evaluate(({count,pattern,offline,rollback,controls})=>fixture.ask({action:'run',count,pattern,offline,rollback,controls}),{count,pattern,offline,rollback,controls});console.log('source events',report.source.events.length);
 assert(report.source.events.some(e=>e[0]===0),'native input polling was observed');
 assert.equal(report.source.events.find(e=>e[0]===2)[1].bytes.length,490);
 report.viewerBoot=await viewer.evaluate(l=>fixture.boot(l,true),language);console.log('fresh viewer booted');
 await viewer.evaluate(({stage,events,dialog,diagnostics})=>fixture.ask({action:'jump',stage,events,dialog,diagnostics}),{stage,events:report.source.events,dialog,diagnostics});
 try{report.viewer=await viewer.evaluate(count=>fixture.ask({action:'run',count:count+30}),count);}
 catch(error){report.viewerFailure=await viewer.evaluate(()=>fixture.lastError);throw error;}
 if(benchmark){
  assert(!controls&&!dialog&&!offline&&!rollback,'benchmark uses the common deterministic battle fixture');
  const baseline=await context.newPage();await baseline.goto(base+'/fixture.html');
  const boot=await baseline.evaluate(l=>fixture.boot(l,true),language);
  const replayPrefix=await baseline.evaluate(count=>fixture.ask({action:'run',count,keys:32}),prefix);
  assert.equal(replayPrefix.checksum,report.prefixSource.checksum,'full replay prefix matches source machine');
  await baseline.evaluate(stage=>fixture.ask({action:'jump',stage}),stage);
  const tail=await baseline.evaluate(({count,pattern})=>fixture.ask({action:'run',count,pattern}),{count,pattern});
  assert.equal(tail.checksum,report.source.checksum,'full reconstruction matches the source at EOF');
  report.benchmark={scope:'same source prefix and QA native stage transition; Worker execution, excludes data transfer and boot',skippedSteps:prefix,fullPrefixMs:replayPrefix.runMs,fullTailMs:tail.runMs,stageTailMs:report.viewer.runMs,fullBootMs:boot.bootMs,stageBootMs:report.viewerBoot.bootMs,fullChecksum:tail.checksum};
  await baseline.close();console.log('benchmark',JSON.stringify(report.benchmark));
 }
 if(controls){assert(report.source.pauses.includes(true)&&report.source.pauses.includes(false),'native pause and resume occurred');assert.deepEqual(report.viewer.pauses,report.source.pauses,'viewer replays native pause without host inputs');assert(report.source.events.some(e=>e[0]===1&&e[4].some(v=>v!==0)),'touch bytes were recorded');}
 if(dialog){assert(report.source.dialogInjected);assert(report.source.dialogReturned,'source leaves real native dialog');assert(report.viewer.dialogReturned,'viewer leaves dialog without input()');}
 assert(report.viewer.cursor>(offline?100:500),'compared substantial native event sequence');
 assert(report.viewer.cursor>=report.source.events.length-8,'viewer reaches validated frontier');
 const frontier=report.viewer.cursor;
 const waiting=await viewer.evaluate(()=>fixture.ask({action:'run',count:5}));
 assert.equal(waiting.cursor,frontier,'underflow does not consume events');
 assert.equal(waiting.completed,0,'underflow restores native continuation');
 assert.deepEqual(waiting.state.ticks,report.viewer.state.ticks,'waiting does not advance game');
 if(process.env.TH05_STAGE_PARITY==='1'&&!rollback&&!offline){
  const baseline=await context.newPage();await baseline.goto(base+'/fixture.html');
  await baseline.evaluate(l=>fixture.boot(l,false,false),language);
  await baseline.evaluate(count=>fixture.ask({action:'run',count,keys:32}),prefix);
  await baseline.evaluate(({stage,dialog})=>fixture.ask({action:'jump',stage,dialog}),{stage,dialog});
  const other=await baseline.evaluate(({count,pattern})=>fixture.ask({action:'run',count,pattern}),{count,pattern});
  assert.equal(other.checksum,report.source.checksum,'optional recorder never changes player machine state');
  report.playerParity={checksum:other.checksum,capture:report.source.costs,disabled:other.costs};
  const fault=await context.newPage();await fault.goto(base+'/fixture.html');await fault.evaluate(l=>fixture.boot(l),language);
  await fault.evaluate(()=>fixture.ask({action:'fault'}));
  const after=await fault.evaluate(()=>fixture.ask({action:'run',count:60,keys:32}));
  assert.equal(after.captureStages,false);assert.equal(after.completed,60);assert(after.state.ticks>0,'sampling failure leaves the player running');
  report.faultIsolation={continuedSteps:after.completed,captureStages:after.captureStages};
 }
 if(process.env.TH05_STAGE_UI==='1'||http){
  const id='00000000-0000-4000-8000-000000000005';
  const header={...report.sourceBoot.historyHeader,...Object.fromEntries(['checksum','coreSha','diskSha','guestSha'].map(k=>[k,report.sourceBoot[k]]))};
  const batches=report.source.batches;
  await source.evaluate(({id,header,batches})=>{
   window.watchChannel=new BroadcastChannel('th05-history-'+id);let index=0,viewer=null;
   const next=()=>{if(index<batches.length)watchChannel.postMessage({...batches[index],type:'batch',to:viewer,bytes:Uint8Array.from(batches[index++].bytes)});else{const frames=batches.reduce((n,b)=>n+b.bytes.length/(header.players*8+13),0);watchChannel.postMessage({type:'bootstrap',to:viewer,frames});watchChannel.postMessage({type:'end',to:viewer,frames,reason:'stage UI fixture'});}};
   watchChannel.onmessage=({data})=>{if(data.type==='subscribe'){viewer=data.viewer;watchChannel.postMessage({type:'begin',to:viewer,header});next();}else if(data.type==='ack')next();};
  },{id,header,batches});
  let uiContext=context,uiURL=base+'/coop-replay.html?live='+id+'&qa=1';
  if(http){
   const post=async(action,data)=>{const r=await requestBridge('POST','/api/'+action,{protocol:'th05-netplay/9',...data});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
   const owner=await post('create',{}),room=owner.room,generation=owner.state.generation;
   const auth={room,generation,token:owner.token};
   await post('settings',{...auth,rank:1,spares:3,bombs:3,players,language,stageWatch:true});
   const members=[owner];for(let n=1;n<players;n++)members.push(await post('join',{room}));
   for(let n=0;n<members.length;n++){await post('character',{room,generation,token:members[n].token,character:characters[n]});}
   for(const member of members)await post('ready',{room,generation,token:member.token,ready:true});
   await post('start',auth);
   const link=await source.evaluate(async({header,batches,auth})=>{
    const {createHistoryHost}=await import('/netplay/history-host.js');
    window.networkHistory=createHistoryHost(header,{record:false,watch:true});
    for(const batch of batches)networkHistory.append(batch.first,Uint8Array.from(batch.bytes),batch.stageFrames);
    networkHistory.end('stage HTTP fixture');networkHistory.connectNetwork(auth);
    for(let n=0;n<400&&!networkHistory.networkURL;n++)await new Promise(r=>setTimeout(r,25));
    if(!networkHistory.networkURL)throw Error(networkHistory.networkStatus);return networkHistory.networkURL;
   },{header,batches,auth});
   uiContext=await browser.newContext();await routes(uiContext);const url=new URL(link);url.searchParams.set('qa','1');uiURL=url.href;
   // Ensure the initial bootstrap can select a complete recorded stage.
   await source.waitForFunction(()=>window.networkHistory?.networkStatus.includes('片段已结束'),null,{timeout:30000});
  }
  const ui=await uiContext.newPage();ui.on('pageerror',e=>report.errors.push(e.message));
  const uiStartMs=Date.now();await ui.goto(uiURL);
  await ui.waitForFunction(()=>window.th05CoopReplayQA?.read().ready||window.th05CoopReplayQA?.read().error,null,{timeout:60000});
  report.uiStart=await ui.evaluate(()=>th05CoopReplayQA.read());
  report.uiReadyMs=Date.now()-uiStartMs;
  assert.equal(report.uiStart.error,null);assert.equal(report.uiStart.stage?.stage,stage);assert(report.uiStart.cursor>=prefix,'UI skips earlier history');
  await ui.waitForFunction(()=>th05CoopReplayQA.read().stage?.event>0||th05CoopReplayQA.read().error,null,{timeout:30000});
  report.uiFirstEventMs=Date.now()-uiStartMs;
  const uiSeekMs=Date.now();
  await ui.locator('#seek-frame').fill(String(report.uiStart.frames));await ui.locator('#seek').click();
  await ui.waitForFunction(()=>window.th05CoopReplayQA.read().completed||window.th05CoopReplayQA.read().error,null,{timeout:90000});
  report.uiEnd=await ui.evaluate(()=>th05CoopReplayQA.read());assert.equal(report.uiEnd.error,null);assert.equal(report.uiEnd.stageFallback,null);assert(report.uiEnd.completed);assert(report.uiEnd.stage.event>500);
  report.uiCatchupMs=Date.now()-uiSeekMs;
  await ui.locator('#end-close').click();await ui.screenshot({path:path.join(root,`reports/stage-watch-${language}-${players}-${stage}${benchmark?'-bench':''}-end.png`)});
  await ui.locator('#canvas').screenshot({path:path.join(root,`reports/stage-watch-${language}-${players}-${stage}${benchmark?'-bench':''}-canvas.png`)});
  assert.equal(await ui.locator('#file').count(),0,'spectator UI has no multiplayer file importer');
  assert.equal(await ui.locator('#play').count(),0,'spectator UI has no offline playback button');
 }
 assert.deepEqual(report.errors,[]);
 report.passed=true;console.log('PASS native event playback',report.viewer.cursor,'of',report.source.events.length);
 }finally{fs.writeFileSync(path.join(root,'reports/stage-watch-'+language+'-'+players+'-'+stage+(pattern?'-pattern':'')+(dialog?'-dialog':'')+(offline?'-offline':'')+(controls?'-controls':'')+(rollback?'-rollback':'')+(http?'-http':'')+(benchmark?'-bench':'')+'.json'),JSON.stringify(report,null,2));await browser.close();bridge?.stdin.end();}
})().catch(error=>{console.error(error);bridge?.kill();process.exitCode=1;});
