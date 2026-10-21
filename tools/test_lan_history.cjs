// Real LAN page + real emulator workers; only lobby/relay are mocked in
// Playwright. No server or listening socket is started.
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const web=path.resolve(__dirname,'../web'),reports=path.resolve(__dirname,'../reports');
const origin='http://127.0.0.1:9877',protocol=fs.readFileSync(path.join(web,'netplay/rollback-queue.js'),'utf8').match(/PROTOCOL='([^']+)'/)[1];
const state={protocol,generation:'history-lan-test',revision:1,phase:'lobby',network:'public-ws',transport:'relay',
  settings:{language:'cn',players:2,rank:1,spares:3,bombs:3,rollback:true},
  slots:{host:1,guest:0,guest2:2},characters:{host:0,guest:1,guest2:2},
  ready:{host:false,guest:false,guest2:false},present:{host:false,guest:false,guest2:false}};
const sockets=new Map(),errors=[],report={};
const info=p=>p.evaluate(()=>th05Lan.info);
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext({acceptDownloads:true});
 const storageFailure=process.env.TH05_STORAGE_FAILURE==='1';
 if(storageFailure)await context.addInitScript(()=>{
  const RealWorker=Worker;globalThis.storageWorkers=[];
  globalThis.Worker=class extends RealWorker{constructor(url,options){super(url,options);if(String(url).includes('external-replay-store-worker'))storageWorkers.push(this);}};
 });
 try{
  await context.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/api/')){
    const action=url.pathname.slice(5),data=route.request().postDataJSON()||Object.fromEntries(url.searchParams);
    if(action==='version')return route.fulfill({json:{protocol,relayAvailable:true,defaultNetwork:'public-ws',build:'history-test'}});
    const role=data.token==='host-token'?'host':'guest';
    if(action==='create'||action==='join'){
     const own=action==='create'?'host':'guest';state.present[own]=true;state.revision++;
     return route.fulfill({json:{room:'1234',token:own+'-token',role:own,state}});
    }
    if(action==='ready')state.ready[role]=data.ready;
    else if(action==='start')state.phase='loading';
    else if(action==='leave'){state.present[role]=false;if(role==='host')state.phase='ended';}
    else if(action!=='events')throw Error('Unexpected lobby action '+action);
    if(action!=='events')state.revision++;
    return route.fulfill({json:{state,messages:[]}});
   }
   const file=path.resolve(web,'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
   const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.wasm':'application/wasm'};
   return route.fulfill({path:file,contentType:types[path.extname(file)]||'application/octet-stream'});
  });
  await context.routeWebSocket('ws://127.0.0.1:9877/relay**',socket=>{
   const url=new URL(socket.url()),role=url.searchParams.get('token').split('-')[0];sockets.set(role,socket);
   socket.onMessage(raw=>{
    const data=JSON.parse(raw),target=sockets.get(data.to);
    if(!target)return;
    // Occasional delayed authoritative input exercises the browser queue.
    const delay=data.type==='input'&&data.frame%17===0?45:0;
    setTimeout(()=>{if(sockets.get(data.to)===target)target.send(JSON.stringify({...data,from:role}));},delay);
   });
   socket.onClose(()=>sockets.delete(role));
   socket.send(JSON.stringify({type:'relay-ready',generation:state.generation}));
   for(const [other,target]of sockets)if(other!==role){
    target.send(JSON.stringify({type:'relay-peer',role,connected:true}));
    socket.send(JSON.stringify({type:'relay-peer',role:other,connected:true}));
   }
  });
  const host=await context.newPage(),guest=await context.newPage();
  for(const p of [host,guest]){p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/lan.html');await p.waitForFunction(()=>!document.getElementById('create').disabled);}
  await host.click('#create');await host.waitForFunction(()=>!!th05Lan.info.room);
  await guest.uncheck('#history-enabled');await guest.fill('#room-code','1234');await guest.click('#join');await guest.waitForFunction(()=>!!th05Lan.info.room);
  await host.click('#ready');await guest.click('#ready');await host.waitForFunction(()=>!document.getElementById('start').disabled);await host.click('#start');
  for(const p of [host,guest])await p.waitForFunction(()=>th05Lan.info.running||!!th05Lan.info.endedReason,null,{timeout:120000});
  report.boot=await Promise.all([host,guest].map(info));assert(report.boot.every(x=>x.running),JSON.stringify(report.boot.map(x=>x.endedReason)));
  const watch=await host.getAttribute('#history-watch','href'),viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(origin+'/'+watch+'&qa=1');
  await host.waitForFunction(()=>th05Lan.info.history.frames>=120,null,{timeout:60000});
  const download=host.waitForEvent('download');await host.click('#history-save');const file=path.join(reports,'lan-history-prefix.th05m');await (await download).saveAs(file);
  report.guestHistory=(await info(guest)).history;assert.equal(report.guestHistory.recording,true);assert(report.guestHistory.frames>0);assert.equal(await guest.isDisabled('#history-save'),false);
  report.export=await info(host);assert.equal(report.export.running,true);assert.equal(report.export.history.recording,true);
  // Saving must not end the game or stop the independent spectator stream.
  await host.waitForFunction(n=>th05Lan.info.history.frames>=n+120,report.export.history.frames,{timeout:60000});
  report.afterExport=await info(host);assert(report.afterExport.frame>report.export.frame);
  if(storageFailure){
   await guest.evaluate(()=>storageWorkers.at(-1).dispatchEvent(new ErrorEvent('error',{message:'injected multiplayer compression failure'})));
   await guest.waitForFunction(()=>!th05Lan.info.history.recording&&document.getElementById('history-status').textContent.includes('录像停止'));
   const failed=await info(guest);
   await guest.waitForFunction(n=>th05Lan.info.frame>=n+18,failed.frame,{timeout:30000});const settled=await info(guest);
   await guest.waitForFunction(n=>th05Lan.info.frame>=n+60,settled.frame,{timeout:30000});const continued=await info(guest);
   assert(continued.running&&continued.frame>settled.frame,'compression failure must preserve live player simulation');
   assert.equal(continued.history.frames,settled.history.frames,'no consumer means history probes and packaging stop');
   assert.equal(await guest.isDisabled('#history-save'),true);
   report.storageFailure={failed,settled,continued};console.log('PASS real multiplayer storage failure preserves confirmed play and stops unused history capture');
  }
  await host.click('#leave');await host.waitForFunction(()=>!th05Lan.info.room);
  await host.waitForFunction(()=>document.getElementById('save-dialog').open);
  await host.screenshot({path:path.join(reports,'lan-save-menu.png'),fullPage:true});
  const finalDownload=host.waitForEvent('download');await host.click('#save-replay');
  const finalFile=path.join(reports,'lan-history-full.th05m');await (await finalDownload).saveAs(finalFile);
  if(storageFailure){assert.equal(await guest.evaluate(()=>document.getElementById('save-dialog').open),false);}
  else {await guest.waitForFunction(()=>document.getElementById('save-dialog').open,null,{timeout:30000});await guest.click('#discard-replay');}
  assert.equal(await guest.isDisabled('#history-save'),true);
  assert.equal(await guest.isVisible('#history-watch'),false);
  report.endPrompt={hostSaved:true,guestDiscarded:!storageFailure,guestStorageFailed:storageFailure};
  await viewer.waitForFunction(()=>th05CoopReplayQA.read().completed||th05CoopReplayQA.read().error,null,{timeout:90000});
  report.live=await viewer.evaluate(()=>th05CoopReplayQA.read());assert.equal(report.live.error,null);assert.equal(report.live.cursor,report.live.frames);
  await viewer.click('#end-close');await viewer.click('#stop');await viewer.setInputFiles('#file',file);await viewer.click('#play');
  await viewer.waitForFunction(()=>th05CoopReplayQA.read().completed||th05CoopReplayQA.read().error,null,{timeout:90000});
  report.replay=await viewer.evaluate(()=>th05CoopReplayQA.read());assert.equal(report.replay.error,null);assert.equal(report.replay.cursor,report.replay.frames);assert(report.replay.frames<report.live.frames);
  await viewer.click('#end-close');await viewer.click('#stop');await viewer.setInputFiles('#file',finalFile);await viewer.click('#play');
  await viewer.waitForFunction(()=>th05CoopReplayQA.read().completed||th05CoopReplayQA.read().error,null,{timeout:90000});
  report.fullReplay=await viewer.evaluate(()=>th05CoopReplayQA.read());assert.equal(report.fullReplay.error,null);assert.equal(report.fullReplay.cursor,report.live.frames);
  // Lobby-only exits have no new recording and must not reopen the previous prompt.
  state.phase='lobby';state.ready.host=false;state.ready.guest=false;
  await host.click('#create');await host.waitForFunction(()=>!!th05Lan.info.room);await host.click('#leave');await host.waitForFunction(()=>!th05Lan.info.room);
  await host.waitForTimeout(500);assert.equal(await host.evaluate(()=>document.getElementById('save-dialog').open),false);
  assert.deepEqual(errors,[]);console.log('PASS actual LAN UI, delayed input, swapped seats, export while running, independent live tail and fresh-core file replay');
 }finally{report.errors=errors;fs.writeFileSync(path.join(reports,storageFailure?'lan-history-storage-failure.json':'lan-history.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
