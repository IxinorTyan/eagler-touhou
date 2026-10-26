// Real emulator + click/number seeking. Local route fulfillment; no server.
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),reports=path.join(root,'reports'),base='http://127.0.0.1:9877';
const stress=process.env.TH05_STRESS==='1',length=stress?3600:720,language=process.env.TH05_LANGUAGE||'cn';
// Share the real-worker capture fixture used by the confirmed-history test.
let harness=fs.readFileSync(path.join(__dirname,'test_multiplayer_history.cjs'),'utf8').match(/const harness=`([\s\S]*?)`;/)[1];
if(stress)harness=harness.replace('frame===120?512:frame===165?1024:32|direction','32|direction').replace('frame>=280?2:0','0');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={},errors=[];let viewer;
 try{
  const context=await browser.newContext();await context.route(base+'/**',async route=>{
   const name=new URL(route.request().url()).pathname;
   if(name==='/capture.html')return route.fulfill({body:harness,contentType:'text/html'});
   const file=path.resolve(web,'.'+name);if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.wasm':'application/wasm','.css':'text/css'})[path.extname(file)]||'application/octet-stream'});
  });
  const source=await context.newPage();await source.goto(base+'/capture.html');await source.waitForFunction(()=>window.capture);
  report.boot=await source.evaluate(language=>capture.boot(language,3,true),language);
  for(let at=0;at<length;at+=360){await source.evaluate(()=>capture.batch(360,true));if(stress)console.log('captured',at+360);}
  const id=report.boot.id,rows=await source.evaluate(()=>capture.rows());
  assert.match(id,/^[a-f0-9-]{36}$/,'live spectator link must use the returned history session ID');
  await source.evaluate(()=>capture.end());
  const proofs=Object.fromEntries(rows.map((row,i)=>[i+1,row]));
  viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(base+'/coop-replay.html?qa=1&live='+id);
  if(stress){report.nativeProgress=proofs[length].ticks-report.boot.boot.state.ticks;assert(report.nativeProgress>length/2,'stress fixture must advance actual gameplay, not remain in a pause menu');}
  const read=()=>viewer.evaluate(()=>th05CoopReplayQA.read());
  const at=async frame=>{
   await viewer.waitForFunction(n=>{const s=th05CoopReplayQA.read();return s.error||(s.cursor===n&&s.target===null&&!s.pending);},frame,{timeout:stress?180000:60000});
   const result=await read();assert.equal(result.error,null);assert.equal(result.cursor,frame);
   for(const key of ['ticks','gameHash','nativeHash'])assert.equal(result.lastProof[key],proofs[frame][key]);return result;
  };
  await viewer.waitForFunction(()=>th05CoopReplayQA.read().ready||th05CoopReplayQA.read().error,null,{timeout:60000});
  assert.equal((await read()).error,null);await viewer.click('#pause');
  assert.equal((await read()).paused,true);
  if(stress){
   report.cycles=[];
   for(let cycle=0;cycle<12;cycle++){
    const frame=[3000,120,2400,360,1800,600,3120,240,1560,1200,3480,480][cycle];
    const began=Date.now();await viewer.fill('#seek-frame',String(frame));await viewer.click('#seek');const state=await at(frame);
    assert.equal(state.paused,true);report.cycles.push({frame,ms:Date.now()-began,proof:state.lastProof});console.log('seek stable',cycle+1,frame);
    if(cycle===0){await viewer.click('#sound');await viewer.waitForFunction(()=>!!th05CoopReplayQA.read().music?.id);}
    else assert((await read()).music?.id,'backward reconstruction must preserve enabled sound');
    await viewer.waitForFunction(()=>th05CoopReplayQA.read().sound?.state==='suspended');
    if(cycle===1){
     await viewer.click('#pause');
     await viewer.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.cursor>=300&&s.sound?.sfx.played>0;},null,{timeout:30000});
     assert.equal((await read()).error,null);await viewer.click('#pause');
     await viewer.waitForFunction(()=>!th05CoopReplayQA.read().pending);report.soundAfterBackward=await read();
     assert(report.soundAfterBackward.sound.sfx.played>0,'effects must play on the new timeline');
    }
   }
   // Stop/restart during boot must ignore stale Worker messages.
   for(let cycle=0;cycle<3;cycle++){
    await viewer.fill('#seek-frame','0');await viewer.click('#seek');await viewer.click('#stop');
    await viewer.click('#play');await viewer.click('#pause');
    await viewer.waitForFunction(()=>th05CoopReplayQA.read().ready||th05CoopReplayQA.read().error,null,{timeout:60000});
    assert.equal((await read()).error,null);
   }
  }
  // A paused seek still rebuilds, then stops at the exact requested frame.
  await viewer.fill('#seek-frame','600');await viewer.click('#seek');report.forward=await at(600);assert.equal(report.forward.paused,true);
  assert(report.forward.sliceStats.count>0,'explicit seek must use spectator slices');
  assert(report.forward.sliceStats.maxSteps<=32,'slice step bound must hold');
  await viewer.fill('#seek-frame','120');await viewer.click('#seek');report.backward=await at(120);assert.equal(report.backward.paused,true);
  await viewer.locator('#timeline').evaluate(element=>{element.value='240';element.dispatchEvent(new Event('change'));});report.timeline=await at(240);
  // A changed target replaces the pending request. No old Worker may update it.
  await viewer.fill('#seek-frame','120');await viewer.click('#seek');await viewer.fill('#seek-frame','360');await viewer.click('#seek');report.replaced=await at(360);
  await viewer.fill('#seek-frame','720');await viewer.click('#seek');await viewer.click('#cancel-seek');
  const cancelled=await read();
  await viewer.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.ready&&!s.pending&&s.target===null&&s.paused;},null,{timeout:60000});
  report.cancelled=await read();assert.equal(report.cancelled.error,null);assert.equal(report.cancelled.target,null);assert.equal(report.cancelled.paused,true);assert(report.cancelled.cursor<=cancelled.cursor+32);
  // Invalid targets do not reset the current core or advance its cursor.
  const before=(await read()).cursor;await viewer.fill('#seek-frame','999999');await viewer.click('#seek');assert.equal((await read()).cursor,before);
  await viewer.fill('#seek-frame',String(length));await viewer.click('#seek');
  if(stress){
   let previous=(await read()).cursor;
   for(let attempt=0;attempt<18;attempt++){
    try{await viewer.waitForFunction(()=>th05CoopReplayQA.read().completed||th05CoopReplayQA.read().error,null,{timeout:10000});break;}
    catch(error){if(error.name!=='TimeoutError')throw error;const state=await read();assert(state.cursor>previous,'EOF reconstruction stopped making progress');previous=state.cursor;console.log('EOF reconstruction',state.cursor,'/',length);}
   }
  }else await viewer.waitForFunction(()=>th05CoopReplayQA.read().completed||th05CoopReplayQA.read().error,null,{timeout:60000});
  report.eof=await read();assert.equal(report.eof.error,null);assert.equal(report.eof.cursor,length);assert.equal(await viewer.isVisible('#completed'),true);
  if(!stress){
   // Corrupt the first proof inside a slice: checking only its final proof
   // would miss this. Production Worker must reject before acknowledging it.
   // Real playback, but deliberately deliver already verified inputs in a
   // burst: passive following must keep audio and 1x pacing until Live is clicked.
   const id=await source.evaluate(async()=>{
    const {createHistoryHost}=await import('/netplay/history-host.js');
    const {packHistoryRows}=await import('/netplay/confirmed-history.js');
    const header=capture.header(),rows=capture.rows();
    window.burstHost=createHistoryHost(header);
    window.publishBurst=(first,count)=>{for(let at=first;at<first+count;at+=60)burstHost.append(at,packHistoryRows(rows.slice(at,Math.min(first+count,at+60)),header.players));};
    publishBurst(0,360);return burstHost.id;
   });
   const follower=await context.newPage();follower.on('pageerror',e=>errors.push(e.message));
   await follower.addInitScript(()=>{
    window.followSteps=[];const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(data,...args){if(data?.type==='step')followSteps.push({frame:data.frame,quiet:!!data.quiet});return post.call(this,data,...args);};
   });
   await follower.goto(base+'/coop-replay.html?qa=1&live='+id);
   await follower.waitForFunction(()=>th05CoopReplayQA.read().ready||th05CoopReplayQA.read().error,null,{timeout:60000});
   await follower.click('#live-edge');
   await follower.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.following&&s.target===null;},null,{timeout:60000});
   await follower.click('#sound');await follower.waitForFunction(()=>th05CoopReplayQA.read().sound?.state==='running');
   const before=await follower.evaluate(()=>{followSteps=[];return th05CoopReplayQA.read().cursor;});
   await source.evaluate(()=>publishBurst(360,360));
   await follower.waitForFunction(n=>{const s=th05CoopReplayQA.read();return s.error||s.cursor>=n+30;},before,{timeout:15000});
   report.passiveFollow=await follower.evaluate(()=>({state:th05CoopReplayQA.read(),steps:followSteps.slice()}));
   assert.equal(report.passiveFollow.state.error,null);
   assert(report.passiveFollow.steps.length>0);assert(report.passiveFollow.steps.every(step=>!step.quiet),'passive live following must not silently accelerate on a burst');
   assert.equal(report.passiveFollow.state.sound.state,'running','passive following must retain enabled audio');
   await follower.click('#live-edge');
   await follower.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.following&&s.target===null&&s.cursor>=630;},null,{timeout:60000});
   assert.equal((await follower.evaluate(()=>th05CoopReplayQA.read())).error,null);
   // A quiet frontier can be a deliberately paused source, not a dead run.
   await follower.waitForTimeout(16000);
   report.quietFrontier=await follower.evaluate(()=>th05CoopReplayQA.read());
   assert.equal(report.quietFrontier.error,null);assert.equal(report.quietFrontier.cursor,630);
   await follower.click('#stop');await follower.close();await source.evaluate(()=>{burstHost.end('test complete');burstHost.dispose();});
  }
  await viewer.screenshot({path:path.join(reports,stress?'seek-stress-'+language+'-completed.png':'seek-test-completed.png')});assert.deepEqual(errors,[]);
  console.log('PASS live spectator forward/backward/click seek, pause, replaced target, cancellation, bounds and verified EOF');
 }finally{if(viewer)report.final=await viewer.evaluate(()=>({qa:globalThis.th05CoopReplayQA?.read(),status:document.getElementById('status')?.textContent})).catch(()=>null);report.errors=errors;fs.writeFileSync(path.join(reports,stress?'seek-stress-'+language+'.json':'seek-test.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
