// Real Workers and file replay. Only HTTP routing is emulated; no server.
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),reports=path.join(root,'reports'),origin='http://127.0.0.1:9877';
const language=process.env.TH05_LANGUAGE||'cn',players=Number(process.env.TH05_PLAYERS||2);
const scenario=process.env.TH05_FLOW||'pause',rollback=process.env.TH05_ROLLBACK==='1';
const harness=`<!doctype html><canvas id="canvas" width="640" height="400"></canvas><script type="module">
import {createHistoryHost} from '/netplay/history-host.js';
let worker,host,frame=0,waiting=new Map(),last=null,failure=null,boot;
const ask=(type,data={},reply=type)=>new Promise((resolve,reject)=>{if(failure)return reject(Error(failure));waiting.set(reply,{resolve,reject});worker.postMessage({type,...data});});
window.flow={
 async boot(language,players,rollback){
  worker=new Worker('/lan-worker.js',{type:'module'});const ctx=document.getElementById('canvas').getContext('2d');
  worker.onmessage=({data})=>{
   if(data.type==='frame'){ctx.drawImage(data.bitmap,0,0);data.bitmap.close();worker.postMessage({type:'frame-ack',seq:data.seq});return;}
   if(data.type==='confirmed-history'){host.append(data.first,data.bytes);return;}
   if(data.type==='error'){failure=data.message;for(const w of waiting.values())w.reject(Error(failure));waiting.clear();return;}
   if(data.type==='stepped')last=data;
   const waiter=waiting.get(data.type);if(waiter){waiting.delete(data.type);waiter.resolve(data);}
  };
  worker.onerror=e=>{failure=e.message;for(const w of waiting.values())w.reject(Error(failure));waiting.clear();};
  boot=await ask('boot',{settings:{language,rollback},config:{rank:1,players:Array.from({length:players},(_,character)=>({character,spares:3,bombs:3}))},viewSlot:0,captureHistory:true},'ready');
  host=createHistoryHost({...boot.historyHeader,coreSha:boot.coreSha,diskSha:boot.diskSha,guestSha:boot.guestSha,checksum:boot.checksum});return boot;
 },
 async run(count,pair,probe=false){for(let n=0;n<count;n++){
   if(probe&&n<2){const wrong=pair.slice();wrong[wrong.length-1]^=4;
    await ask('step',{frame,pair:wrong,predicted:true,offlineMask:0},'stepped');await ask('restore',{frame},'restored');}
   await ask('step',{frame,pair,predicted:false,offlineMask:0},'stepped');frame++;
   await ask('confirm',{prefix:frame,notify:true},'history-confirmed');
  }return this.read();},
 read(){return worker?ask('flow-read',{},'flow-state'):Promise.resolve(null);},
 async seal(){await ask('history-flush',{request:1},'history-flushed');const blob=await host.seal('internal flow fixture');return {bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),row:host.history.row(frame-1),frames:frame};},
 close(){host?.end('flow fixture complete');host?.dispose();worker?.terminate();worker=null;}
};
</script>`;
// Appended read-only diagnostics are served identically to capture and replay,
// and therefore enter the adapter identity. No production QA endpoint exists.
const diagnostics=`
const flowScenario=${JSON.stringify(scenario)};
const flowAdvance=advance;
advance=function(pair,predicted,offlineMask){
 if(flowScenario==='dialog'&&frame===120){
  const d=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;mod.HEAPU8[d+0x3515]=0;
 }
 if(flowScenario==='continue'&&frame===120){
  const h=mod.HEAPU8,layout=nativePlayers(h,mailbox,patch);
  for(let slot=0;slot<layout.count;slot++){h[layout.stocks[slot]]=1;h[layout.liveStates[slot]+30]=0;h[layout.liveStates[slot]+35]=1;}
 }
 if(flowScenario==='stages'&&frame>=120&&frame<=2520&&(frame-120)%600===0){
  const h=mod.HEAPU8,v=new DataView(h.buffer),d=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
  const resident=guestBase+v.getUint16(d+0x41fe,true)*16+v.getUint16(d+0x41fc,true);
  h[resident+0x13]=(frame-120)/600+1;h[d+0x576c]=2;
 }
 return flowAdvance(pair,predicted,offlineMask);
};
const flowDispatch=onmessage;
onmessage=async event=>{
 if(event.data.type==='flow-read'){
  const h=mod.HEAPU8,v=new DataView(h.buffer),c=mailbox-patch.mailbox_cs_offset,d=c+(patch.data_segment-patch.code_segment)*16;
  send('flow-state',{state:state(),nativePause:nativePause(),oldP1,escapeTicks,lastPauseRequests,continues:h[d+0x3702],stdUpdate:v.getUint16(d+0xc656,true),scrollSpeed:h[d+0x3515],program:mod.UTF8ToString(mod._emGetRunningProgram()),boss:{phase:h[d+0x5ac9],hp:v.getInt16(d+0x5ac6,true)},sequence:h[d+0x576c]});return;
 }
 return flowDispatch(event);
};`;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext(),errors=[],report={language,players,scenario,rollback,trace:[]};let page,viewer;
 try{
  await context.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());if(url.pathname==='/flow.html')return route.fulfill({contentType:'text/html',body:harness});
   const file=path.resolve(web,'.'+url.pathname);if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   if(url.pathname==='/lan-worker.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8')+diagnostics});
   return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});
  });
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/flow.html');
  report.boot=await page.evaluate(args=>flow.boot(...args),[language,players,rollback]);
  const pair=(first=0,other=0)=>Array.from({length:players},(_,i)=>i?other:first);
  const run=async(label,count,input,probe=false)=>{const result=await page.evaluate(args=>flow.run(...args),[count,input,probe]);report.trace.push({label,...result});console.log(label,JSON.stringify({frame:result.state?.frame,ticks:result.state?.ticks,stage:result.state?.stage,generation:result.state?.generation,paused:result.nativePause,program:result.program,sequence:result.sequence}));return result;};
  const initial=await run('battle',120,pair(32|8,32|4));
  if(scenario==='stages'){
   let previous=report.boot.state;
   for(let stage=1;stage<=5;stage++){
    const result=await run('stage loader '+(stage+1),600,pair());
    assert.equal(result.state.stage,stage);assert(result.state.generation>previous.generation);assert(result.state.ticks>previous.ticks);
    assert.deepEqual(result.state.characters,report.boot.state.characters);assert(result.state.players.every(p=>p.lives>0&&!p.ghost));
    previous=result.state;
   }
  }else if(scenario==='dialog'){
   const waiting=await run('dialog waiting',180,pair());assert.equal(waiting.stdUpdate,initial.stdUpdate);assert(waiting.state.ticks<initial.state.ticks+10);
   await page.locator('#canvas').screenshot({path:path.join(reports,'flow-'+language+'-dialog.png')});
   let result=waiting;
   for(let attempt=0;attempt<80;attempt++){
    await run('dialog Z '+attempt,12,pair(32));result=await run('dialog release '+attempt,12,pair());
    if(result.stdUpdate!==initial.stdUpdate)break;
   }
   assert.notEqual(result.stdUpdate,initial.stdUpdate,'native dialog must return and activate the boss');
   const after=await run('battle after dialog',180,pair(32,32));assert(after.state.ticks>result.state.ticks+30);
  }else if(scenario==='continue'){
   const out=await run('all out native update',180,pair());assert(out.state.players.every(p=>p.ghost));
   const stopped=await run('continue menu waiting',120,pair());assert.equal(stopped.state.ticks,out.state.ticks);
   await page.locator('#canvas').screenshot({path:path.join(reports,'flow-'+language+'-continue.png')});
   let result=stopped;
   for(let attempt=0;attempt<12;attempt++){
    await run('continue confirm '+attempt,6,pair(32));result=await run('continue settling '+attempt,45,pair());
    if(result.state.players.every(p=>!p.ghost&&p.lives>0)&&result.state.ticks>stopped.state.ticks+3)break;
   }
   assert(result.state.players.every(p=>!p.ghost&&p.lives>0),'native continue revives all seats');assert(result.continues>0);
   const after=await run('battle after continue',120,pair(32,32));assert(after.state.ticks>result.state.ticks+30);
  }else{
  await run('pause request',6,pair(512),rollback);
  const held=await run('pause held',60,pair());assert.equal(held.nativePause,1);
  await page.locator('#canvas').screenshot({path:path.join(reports,'flow-'+language+'-pause.png')});
  await run('resume request',6,pair(1024));
  let resumed=await run('resume settling',60,pair());
  if(resumed.nativePause){await run('menu confirm',6,pair(256));resumed=await run('confirm settling',60,pair());}
  assert.equal(resumed.nativePause,0,'real native pause must close');
  const continued=await run('battle after pause',180,pair(32|4,32|8));assert(continued.state.ticks>resumed.state.ticks+30);
  await run('held-fire pause request',6,pair(512,32|8),rollback);
  await run('held-fire paused',60,pair(0,32|8));
  await run('held-fire resume request',6,pair(1024,32|8),rollback);
  const heldResume=await run('held-fire resume settling',90,pair(0,32|8));
  assert.equal(heldResume.nativePause,0,'a teammate holding gameplay input must not trap the pause menu');
  }
  const capture=await page.evaluate(()=>flow.seal()),file=path.join(reports,'flow-'+scenario+'-'+language+'-'+players+'.th05m');fs.writeFileSync(file,Buffer.from(capture.bytes));report.capture={frames:capture.frames,row:capture.row};
  await page.evaluate(()=>flow.close());viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));
  await viewer.goto(origin+'/coop-replay.html?qa=1');await viewer.setInputFiles('#file',file);await viewer.click('#play');
  await viewer.fill('#seek-frame',String(capture.frames));await viewer.click('#seek');
  await viewer.waitForFunction(()=>th05CoopReplayQA.read().completed||th05CoopReplayQA.read().error,null,{timeout:90000});report.playback=await viewer.evaluate(()=>th05CoopReplayQA.read());assert.equal(report.playback.error,null);assert.equal(report.playback.cursor,capture.frames);
  for(const key of ['ticks','gameHash','nativeHash'])assert.equal(report.playback.lastProof[key],capture.row[key]);assert.deepEqual(errors,[]);
  console.log('PASS native flow and fresh-core replay',scenario,language,players);
 }finally{
  if(page)report.final=await page.evaluate(()=>flow.read()).catch(()=>null);report.errors=errors;
  fs.writeFileSync(path.join(reports,'replay-flow-'+scenario+'-'+language+'-'+players+'.json'),JSON.stringify(report,null,2));await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
