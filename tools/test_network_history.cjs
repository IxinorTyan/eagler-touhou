// Separate browser contexts + real HTTP handlers over stdio. No server/socket.
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),readline=require('node:readline');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),reports=path.join(root,'reports'),origin='http://127.0.0.1:9877';
const protocol=fs.readFileSync(path.join(web,'netplay/rollback-queue.js'),'utf8').match(/PROTOCOL='([^']+)'/)[1];
const stages=process.env.TH05_STAGE_WATCH==='1';
const stress=process.env.TH05_STRESS==='1',began=Date.now();
const bridge=spawn('python',['tools/test_history_service.py','--bridge'],{cwd:root,stdio:['pipe','pipe','pipe']});
let serial=0;const pending=new Map(),sockets=new Map(),errors=[],report={};
bridge.stderr.on('data',data=>process.stderr.write(data));
readline.createInterface({input:bridge.stdout}).on('line',line=>{const value=JSON.parse(line);pending.get(value.id)?.(value);pending.delete(value.id);});
function request(method,url,data){return new Promise(resolve=>{const id=++serial;pending.set(id,resolve);bridge.stdin.write(JSON.stringify({id,method,url,data})+'\n');});}
let lostUpload=false,failedRead=false,uploadRetry=false,lostFirst=null;
let outageUntil=0,outageReads=0,outagePushes=0,htmlFailure=false;
const specialAssetRequests=[];
async function routes(context){
 await context.route(origin+'/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(/(?:patch-stage-|th05-stage-|stage-runtime|wdosbox-x-stage|frame-replay-(?:core|ending|cn|jp))/.test(url.pathname))specialAssetRequests.push(url.pathname);
  if(url.pathname.startsWith('/api/')){
   const data=req.method()==='POST'?req.postDataJSON():null;
   if(stress&&Date.now()<outageUntil&&['/api/history','/api/history-push'].includes(url.pathname)){
    if(url.pathname==='/api/history')outageReads++;else outagePushes++;
    return route.abort();
   }
   const reply=await request(req.method(),url.pathname+url.search,data);
   if(stress&&url.pathname==='/api/history'&&failedRead&&!htmlFailure){htmlFailure=true;return route.fulfill({status:502,contentType:'text/html',body:'<h1>Bad gateway</h1>'});}
   if(url.pathname==='/api/history-push'&&data.payload){
    if(!lostUpload&&reply.status===200){lostUpload=true;lostFirst=data.first;return route.abort();}
    if(data.first===lostFirst)uploadRetry=true;
   }
   if(url.pathname==='/api/history'&&!failedRead){failedRead=true;return route.fulfill({status:503,json:{error:'test transient disconnect'}});}
   return route.fulfill({status:reply.status,json:reply.body});
  }
  const file=path.resolve(web,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});
 });
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 let viewer,host,guest;
 try{
  const players=await browser.newContext({acceptDownloads:true}),spectators=await browser.newContext();await routes(players);await routes(spectators);
  await players.routeWebSocket('ws://127.0.0.1:9877/relay**',socket=>{
   const url=new URL(socket.url()),role=url.searchParams.get('role');
   // Relay URL carries a player token. Resolve its role from the real lobby.
   (async()=>{
    const auth={room:url.searchParams.get('room'),token:url.searchParams.get('token'),generation:url.searchParams.get('generation'),protocol};
    const state=await request('GET','/api/events?'+new URLSearchParams(auth));
    assert.equal(state.status,200);
    const own=role||[...tokens].find(([,token])=>token===auth.token)?.[0];assert(own,'unknown relay role');sockets.set(own,socket);
    socket.onMessage(raw=>{const data=JSON.parse(raw),target=sockets.get(data.to);if(target)setTimeout(()=>{if(sockets.get(data.to)===target)target.send(JSON.stringify({...data,from:own}));},data.type==='input'&&data.frame%17===0?35:0);});
    socket.onClose(()=>sockets.delete(own));socket.send(JSON.stringify({type:'relay-ready',generation:auth.generation}));
    for(const [other,target]of sockets)if(other!==own){target.send(JSON.stringify({type:'relay-peer',role:own,connected:true}));socket.send(JSON.stringify({type:'relay-peer',role:other,connected:true}));}
   })().catch(error=>errors.push(error.message));
  });
  const tokens=new Map();players.on('response',async response=>{if(['/api/create','/api/join'].includes(new URL(response.url()).pathname)){const data=await response.json();tokens.set(data.role,data.token);}});
  host=await players.newPage();guest=await players.newPage();
  for(const page of [host,guest]){page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/lan.html');await page.waitForFunction(()=>!document.getElementById('create').disabled);}
  console.log('lobby ready');await host.click('#create');await host.waitForFunction(()=>!!th05Lan.info.room);const room=(await host.evaluate(()=>th05Lan.info)).room;
  await guest.fill('#room-code',room);await guest.click('#join');await guest.waitForFunction(()=>!!th05Lan.info.room);
  if(stages){assert(await host.locator('#stageWatch').isDisabled());assert.equal(await host.locator('#stageWatch option[value="true"]').count(),0);report.instrumentedStageEntryDisabled=true;}
  await host.click('#ready');await guest.click('#ready');await host.waitForFunction(()=>!document.getElementById('start').disabled);await host.click('#start');
  for(const page of [host,guest])await page.waitForFunction(()=>th05Lan.info.running||!!th05Lan.info.endedReason,null,{timeout:120000});
  console.log('players booted');report.boot=await Promise.all([host,guest].map(p=>p.evaluate(()=>th05Lan.info)));assert(report.boot.every(x=>x.running),JSON.stringify(report.boot));assert.deepEqual(specialAssetRequests,[],'players must keep the ordinary disks and cores');
  await host.locator('#history-network-watch').waitFor({state:'visible',timeout:30000});const link=await host.getAttribute('#history-network-watch','href');assert(link.includes('#watch='));assert(!link.includes(report.boot[0].token||'TOKEN-NEVER-PRESENT'));
  viewer=await spectators.newPage();viewer.on('pageerror',e=>errors.push(e.message));
  await viewer.goto(origin+'/lan.html');await viewer.waitForFunction(()=>!document.getElementById('watch').disabled);
  await viewer.click('#watch');assert.match(await viewer.locator('#status').innerText(),/四位房间号/);
  await viewer.fill('#room-code',room);assert.equal((await viewer.evaluate(()=>th05Lan.info)).role,undefined);
  await viewer.click('#watch');await viewer.waitForURL('**/coop-replay.html#watch=*');
  assert.equal(new URL(viewer.url()).hash,new URL(link).hash,'room button resolves the published read-only stream');
  const url=new URL(viewer.url());url.searchParams.set('qa','1');await viewer.goto(url.href);
  console.log('watch opened');const read=()=>viewer.evaluate(()=>th05CoopReplayQA.read());
  await viewer.waitForFunction(()=>th05CoopReplayQA.read().cursor>=30||th05CoopReplayQA.read().error,null,{timeout:90000});report.joined=await read();assert.equal(report.joined.error,null);
  await viewer.click('#pause');await viewer.waitForFunction(()=>!th05CoopReplayQA.read().pending);report.paused=await read();
  await viewer.waitForFunction(n=>th05CoopReplayQA.read().frames>=n+150,report.paused.frames,{timeout:60000});report.buffered=await read();assert.equal(report.buffered.cursor,report.paused.cursor);
  await viewer.click('#live-edge');await viewer.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.following&&s.target===null;},null,{timeout:60000});report.caughtUp=await read();assert.equal(report.caughtUp.error,null);assert(report.caughtUp.cursor>report.paused.cursor);
  if(stress){
   report.soak=[];
   for(let cycle=0;cycle<12;cycle++){
    const before=await host.evaluate(()=>th05Lan.info);assert.equal(before.running,true);
    if(cycle===2||cycle===7){outageUntil=Date.now()+5500;console.log('temporary network outage',cycle);}
    if(cycle%3===0){await viewer.click('#pause');await viewer.waitForFunction(()=>!th05CoopReplayQA.read().pending);}
    // Let the real players and spectator run for ten seconds per sample.
    await viewer.waitForTimeout(10000);
    const state=await read();assert.equal(state.error,null);
    const after=await host.evaluate(()=>th05Lan.info);assert.equal(after.running,true);assert(after.history.frames>before.history.frames,'spectator failure must not stall players');
    if(state.paused){await viewer.click('#live-edge');await viewer.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.following&&s.target===null;},null,{timeout:60000});assert.equal((await read()).error,null);}
    report.soak.push({seconds:(Date.now()-began)/1000,playerFrame:after.frame,confirmed:after.history.frames,viewer:await read()});console.log('soak sample',cycle+1,'player',after.history.frames,'viewer',(await read()).cursor);
   }
   // New independent session joins a substantial archive; close the old reader.
   await viewer.close();viewer=await spectators.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(url.href);
   await viewer.waitForFunction(()=>th05CoopReplayQA.read().ready||th05CoopReplayQA.read().error,null,{timeout:60000});assert.equal((await read()).error,null);
   const catchupBegan=Date.now();
   report.rejoinTarget=await viewer.evaluate(()=>{document.getElementById('live-edge').click();return th05CoopReplayQA.read().target;});
   console.log('long-history target',report.rejoinTarget);
   await viewer.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.following&&s.target===null;},null,{timeout:90000});report.rejoined=await read();report.rejoinMs=Date.now()-catchupBegan;assert.equal(report.rejoined.error,null);
   console.log('long-history caught up',report.rejoined.cursor,'in',report.rejoinMs,'ms');
   assert(outageReads&&outagePushes&&htmlFailure);report.outages={outageReads,outagePushes,htmlFailure};
  }
  const download=host.waitForEvent('download');await host.click('#history-save');await (await download).saveAs(path.join(reports,'network-prefix.th05m'));
  report.exported=await host.evaluate(()=>th05Lan.info);assert.equal(report.exported.running,true);
  await host.waitForFunction(n=>th05Lan.info.history.frames>=n+60,report.exported.history.frames,{timeout:60000});
  await host.click('#leave');await host.waitForFunction(()=>!th05Lan.info.room);
  await viewer.waitForFunction(()=>th05CoopReplayQA.read().completed||th05CoopReplayQA.read().error,null,{timeout:90000});report.end=await read();assert.equal(report.end.error,null);assert.equal(report.end.cursor,report.end.frames);assert(await viewer.isVisible('#completed'));
  assert(lostUpload&&uploadRetry&&failedRead);assert.deepEqual(errors,[]);report.faults={lostUpload,uploadRetry,failedRead};
  console.log('PASS isolated spectator context, real HTTP handlers, lost upload ACK, read retry, paused buffering, live catch-up, export and verified EOF');
 }finally{
  report.players=await Promise.all([host,guest].filter(Boolean).map(p=>p.evaluate(()=>({info:th05Lan.info,status:document.getElementById('status').textContent})).catch(()=>null)));if(viewer)report.final=await viewer.evaluate(()=>({qa:th05CoopReplayQA.read(),status:document.getElementById('status').textContent})).catch(()=>null);
  report.elapsedSeconds=(Date.now()-began)/1000;report.errors=errors;fs.writeFileSync(path.join(reports,stress?'network-stress.json':stages?'network-stage-history.json':'network-history.json'),JSON.stringify(report,null,2));await browser.close();bridge.stdin.end();
 }
})().catch(error=>{console.error(error);bridge.kill();process.exitCode=1;});
