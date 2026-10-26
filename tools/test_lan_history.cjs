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
 const context=await browser.newContext();
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
  report.guestHistory=(await info(guest)).history;assert.equal(report.guestHistory?.frames||0,0,'watch-disabled player creates no spectator history');
  report.liveStart=await info(host);assert(report.liveStart.running&&report.liveStart.history.frames>=120);
  assert.equal(await host.locator('#history-save').count(),0,'multiplayer history has no export control');
  assert.equal(await viewer.locator('#file').count(),0,'spectator page has no multiplayer file importer');
  await host.waitForFunction(n=>th05Lan.info.history.frames>=n+120,report.liveStart.history.frames,{timeout:60000});
  report.liveTail=await info(host);assert(report.liveTail.running&&report.liveTail.history.frames>report.liveStart.history.frames);
  await host.click('#leave');await host.waitForFunction(()=>!th05Lan.info.room);
  assert.equal(await guest.isVisible('#history-watch'),false);
  await viewer.waitForFunction(()=>th05CoopReplayQA.read().completed||th05CoopReplayQA.read().error,null,{timeout:90000});
  report.live=await viewer.evaluate(()=>th05CoopReplayQA.read());assert.equal(report.live.error,null);assert.equal(report.live.cursor,report.live.frames);
  // Lobby-only exits have no new recording and must not reopen the previous prompt.
  state.phase='lobby';state.ready.host=false;state.ready.guest=false;
  await host.click('#create');await host.waitForFunction(()=>!!th05Lan.info.room);await host.click('#leave');await host.waitForFunction(()=>!th05Lan.info.room);
  await host.waitForTimeout(500);assert.equal(await host.locator('#save-dialog').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS actual LAN UI, delayed input, watch-disabled player and live spectator EOF without multiplayer files');
 }finally{report.errors=errors;fs.writeFileSync(path.join(reports,'lan-history.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
