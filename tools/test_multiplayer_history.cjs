// Real emulator recording and fresh-core replay. Requests are fulfilled from
// local files: no HTTP/WS server and no listener are started.
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const web=path.resolve(__dirname,'../web'),reports=path.resolve(__dirname,'../reports');
const harness=`<!doctype html><canvas id="canvas"></canvas><script type="module">
import {createHistoryHost} from '/netplay/history-host.js';
import {packTouch} from '/touch-input.js';
let worker,host,boot,frame=0,waiters=new Map(),failure=null,flush=0,playerCount=0,lastState=null,lastHash=null;
const next=type=>new Promise((resolve,reject)=>waiters.set(type,{resolve,reject}));
function send(type,data,reply){const promise=next(reply);worker.postMessage({type,...data});return promise;}
window.capture={
 async boot(language,players,rollback,collect=true){
  playerCount=players;
  worker=new Worker('/lan-worker.js',{type:'module'});
  worker.onerror=e=>{failure=e.message;for(const w of waiters.values())w.reject(Error(failure));waiters.clear();};
  worker.onmessage=({data})=>{
   if(data.type==='frame'){data.bitmap.close();worker.postMessage({type:'frame-ack',seq:data.seq});return;}
   if(data.type==='confirmed-history'){host.append(data.first,data.bytes);return;}
   if(data.type==='hash')lastHash=data.hash;
   if(data.type==='stepped'&&data.state)lastState=data.state;
   if(data.type==='error'){failure=data.message;for(const w of waiters.values())w.reject(Error(failure));waiters.clear();return;}
   const w=waiters.get(data.type);if(w){waiters.delete(data.type);w.resolve(data);}
  };
  const config={rank:1,players:Array.from({length:players},(_,character)=>({character,spares:3,bombs:3}))};
  boot=await send('boot',{settings:{language,rollback},config,viewSlot:players-1,captureHistory:collect},'ready');
  host=collect?createHistoryHost({...boot.historyHeader,coreSha:boot.coreSha,diskSha:boot.diskSha,guestSha:boot.guestSha,checksum:boot.checksum}):null;
  return {id:host?.id,boot};
 },
 async batch(count,rollback){
  const players=playerCount;
  for(let n=0;n<count;n++){
   let offlineMask=frame>=280?2:0;
   const pair=Array.from({length:players},(_,slot)=>{
    if(offlineMask&(1<<slot))return 0;
    const direction=(Math.floor(frame/40)+slot)%2?4:8;
    return slot===0?(32|direction):
      slot===2?packTouch(32|64,{active:frame%50<25,x:16,y:-8}):32|direction;
   });
   if(rollback&&frame===204){
    const predicted=pair.slice();predicted[1]=16;
    await send('step',{frame,pair:predicted,predicted:true,offlineMask},'stepped');
    await send('restore',{frame},'restored');
   }
   await send('step',{frame,pair,predicted:false,offlineMask},'stepped');frame++;
   worker.postMessage({type:'confirm',prefix:frame});
  }
  await send('history-flush',{request:++flush},'history-flushed');
  return {frame,recorded:host?.history.frames,failure,tail:host?.history.row(frame-1),lastHash,stepMeanMs:lastState.costs.reduce((a,b)=>a+b,0)/lastState.costs.length};
 },
 async seal(){const file=await host.seal('自动化帧前缀');return Array.from(new Uint8Array(await file.arrayBuffer()));},
 async rejectSpectatorSlice(){
  try{await send('history-slice',{frame,rows:[{pair:Array(playerCount).fill(0),offlineMask:0,ticks:0,gameHash:0,nativeHash:0}]},'history-sliced');return null;}
  catch(error){return error.message;}
 },
 end(){host?.end('自动化片段结束');worker.terminate();worker=null;},
 read(){return {frame,recorded:host?.history.frames,failure};}
};
</script>`;
(async()=>{
 const language=process.env.TH05_LANGUAGE||'cn',players=Number(process.env.TH05_PLAYERS||2),rollback=process.env.TH05_ROLLBACK==='1';
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext(),errors=[],report={language,players,rollback};
 await context.route('http://127.0.0.1:9877/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/history-test.html')return route.fulfill({body:harness,contentType:'text/html'});
  const file=path.resolve(web,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
  const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.wasm':'application/wasm'};
  return route.fulfill({path:file,contentType:types[path.extname(file)]||'application/octet-stream'});
 });
 const capture=await context.newPage();capture.on('pageerror',e=>errors.push(e.message));
 try{
  await capture.goto('http://127.0.0.1:9877/history-test.html');await capture.waitForFunction(()=>window.capture);
  report.boot=await capture.evaluate(args=>window.capture.boot(...args),[language,players,rollback]);console.log('recording booted',language,players);
  report.first=await capture.evaluate(r=>window.capture.batch(180,r),rollback);
  assert.equal(report.first.recorded,180);
  // Same-browser viewer joins after 180 frames, then receives the live tail.
  const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));
  await viewer.goto('http://127.0.0.1:9877/coop-replay.html?qa=1&live='+report.boot.id);
  await viewer.waitForFunction(()=>window.th05CoopReplayQA?.read().frames===180,null,{timeout:30000});
  report.final=await capture.evaluate(r=>window.capture.batch(180,r),rollback);
  assert.equal(report.final.recorded,360);
  assert(report.final.tail.ticks>report.first.tail.ticks+60,'native battle must advance while touch input is recorded');
  const bytes=await capture.evaluate(()=>window.capture.seal()),file=path.join(reports,'multiplayer-history-'+language+'-'+players+'.th05m');
  fs.writeFileSync(file,Buffer.from(bytes));report.bytes=bytes.length;
  await capture.evaluate(()=>window.capture.end());
  await viewer.waitForFunction(()=>window.th05CoopReplayQA.read().ready||window.th05CoopReplayQA.read().error,null,{timeout:60000});
  assert.equal((await viewer.evaluate(()=>window.th05CoopReplayQA.read())).error,null);
  await viewer.click('#sound');await viewer.waitForFunction(()=>!!window.th05CoopReplayQA.read().music?.id);
  await viewer.click('#pause');const paused=await viewer.evaluate(()=>window.th05CoopReplayQA.read().cursor);
  await viewer.waitForTimeout(700);const after=await viewer.evaluate(()=>window.th05CoopReplayQA.read().cursor);
  assert(after<=paused+1,'only already in-flight frame may finish during pause');
  // Input isolation and source termination do not discard the buffered tail.
  await viewer.keyboard.press('ArrowRight');await viewer.keyboard.press('KeyZ');await viewer.click('#pause');
  await viewer.waitForFunction(()=>window.th05CoopReplayQA.read().completed||window.th05CoopReplayQA.read().error,null,{timeout:60000});
  report.live=await viewer.evaluate(()=>window.th05CoopReplayQA.read());assert.equal(report.live.error,null);assert.equal(report.live.cursor,360);
  await viewer.screenshot({path:path.join(reports,'multiplayer-history-'+language+'-'+players+'-live.png')});
  await viewer.click('#end-close');await viewer.click('#stop');await viewer.setInputFiles('#file',file);await viewer.click('#play');
  await viewer.waitForFunction(()=>window.th05CoopReplayQA.read().completed||window.th05CoopReplayQA.read().error,null,{timeout:90000});
  report.playback=await viewer.evaluate(()=>window.th05CoopReplayQA.read());assert.equal(report.playback.error,null);assert.equal(report.playback.cursor,360);
  assert.deepEqual(report.live.lastProof,report.playback.lastProof);assert.equal(await viewer.locator('#completed').isVisible(),true);
  // Capture disabled must leave the exact same native simulation checksum.
  const baseline=await context.newPage();await baseline.goto('http://127.0.0.1:9877/history-test.html');
  await baseline.waitForFunction(()=>window.capture);
  const baselineBoot=await baseline.evaluate(args=>window.capture.boot(...args),[language,players,rollback,false]);
  assert.equal(baselineBoot.boot.checksum,report.boot.boot.checksum);assert.equal(baselineBoot.boot.historyHeader,null);
  report.baseline=await baseline.evaluate(r=>window.capture.batch(360,r),rollback);
  assert.equal(report.baseline.lastHash,report.final.lastHash);
  report.playerSliceRejected=await baseline.evaluate(()=>window.capture.rejectSpectatorSlice());
  assert.equal(report.playerSliceRejected,'旁观推进批次无效','player core must reject the spectator-only path');await baseline.evaluate(()=>window.capture.end());
  assert.deepEqual(errors,[]);console.log('PASS live tail, viewer pause, file import and exact confirmed EOF',language,players,report.bytes,'bytes');
 }finally{report.errors=errors;fs.writeFileSync(path.join(reports,'multiplayer-history-'+language+'-'+players+'.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
