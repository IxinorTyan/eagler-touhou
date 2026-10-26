const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1100,height:1100}}),page=await context.newPage(),errors=[],report={},language=process.env.TH05_LANGUAGE||'cn';
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 if(process.env.TH05_OFFLINE==='1'){
  const web=path.join(__dirname,'../web');
  await page.context().addInitScript(()=>{
   const add=Worklet.prototype.addModule;
   Worklet.prototype.addModule=async function(url,options){const response=await fetch(url);const blob=URL.createObjectURL(new Blob([await response.text()],{type:'text/javascript'}));try{return await add.call(this,blob,options);}finally{URL.revokeObjectURL(blob);}};
  });
  await page.context().route('http://127.0.0.1:9877/**',async route=>{
   const pathname=decodeURIComponent(new URL(route.request().url()).pathname);
   const file=path.resolve(web,'.'+pathname);
   if(!file.startsWith(web+path.sep)||!fs.existsSync(file)){await route.fulfill({status:404,body:'Not found'});return;}
   const types={'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm'};
   await route.fulfill({path:file,contentType:types[path.extname(file)]||'application/octet-stream'});
  });
 }
 async function armDialog(target){
  if(process.env.TH05_DIALOG!=='1')return;
  await target.waitForFunction(()=>window.th05ReplayQA.read().state?.frameReplay,null,{timeout:45000});
  const worker=target.workers().find(w=>w.url().includes('dosbox-worker'));
  const payload=fs.readFileSync(path.join(__dirname,'../build/frame-replay.bin'));
  const leave=payload.readUInt16LE(payload.length-6);
  await worker.evaluate(({leave})=>{
   const original=frameBridge.signal;
   frameBridge.signal=(port,packed)=>{
    if(port===0x7ff1&&frameBridge.status.frames===180){
     const h=mod.HEAPU8,v=new DataView(h.buffer),sig=new TextEncoder().encode(patch.signature);
     let at=h.indexOf(sig[0]);while(at>=0&&!sig.every((b,i)=>h[at+i]===b))at=h.indexOf(sig[0],at+1);
     if(at<0)throw Error('QA mailbox missing');
     const cs=at-patch.mailbox_cs_offset,d=cs+((packed>>>16)-(packed&65535))*16;
     const stub=leave,call=(0x13e58-0xae10-stub-4)&65535,old=v.getUint16(d+0xc656,true);
     // QA only: call the real native dialog once instead of this STD update.
     // Restore STD immediately afterwards. The exit hook is unused in this manual-stop fixture.
     h.set([0x0e,0xe8,call&255,call>>>8,0xc7,0x06,0x56,0xc6,old&255,old>>>8,0xc3],cs+stub);
     v.setUint16(d+0xc656,stub,true);
    }
    return original(port,packed);
   };
  },{leave});
 }
 async function passDialog(target){
  await target.waitForFunction(()=>window.th05ReplayQA.read().state?.frameReplay.dialog,null,{timeout:30000});
  const read=()=>target.evaluate(()=>window.th05ReplayQA.read());
  await target.waitForTimeout((await read()).mode==='playback'?4500:1500);
  const before=await read();await target.waitForTimeout(1000);
  assert.equal((await read()).state.frameReplay.frames,before.state.frameReplay.frames,'dialog waiting does not consume Replay input');
  await target.locator('#canvas').focus();
  if((await read()).mode==='playback'){
   await target.keyboard.press('Escape');await target.waitForTimeout(200);
   assert.equal((await read()).state.paused,true,'Esc pauses even inside native dialog');
   await target.keyboard.press('Space');
  }
  if(process.env.TH05_CTRL==='1'){
   await target.keyboard.down('ControlLeft');
   await target.waitForFunction(()=>!window.th05ReplayQA.read().state?.frameReplay.dialog,null,{timeout:20000});
   await target.keyboard.up('ControlLeft');
   return;
  }
  for(let i=0;i<80;i++){
   if(!(await read()).state?.frameReplay.dialog)break;
   await target.keyboard.press('KeyZ',{delay:120});await target.waitForTimeout(150);
  }
  assert.equal((await read()).state.frameReplay.dialog,false,'viewer can advance the real native dialog');
 }
 const read=()=>page.evaluate(()=>window.th05ReplayQA.read());
 const tap=async(code,ms=200)=>{await page.evaluate(c=>window.th05ReplayQA.key(c,true),code);await page.waitForTimeout(ms);await page.evaluate(c=>window.th05ReplayQA.key(c,false),code);await page.waitForTimeout(350);};
 try{
  await page.goto((process.env.TH05_URL||'http://127.0.0.1:9877')+'/solo-replay.html?qa=1');await page.selectOption('#language',language);await page.click('#record');
  await page.waitForFunction(()=>window.th05ReplayQA.read().state||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:45000});
  console.log('boot',await page.locator('#status').innerText());
  for(let i=0;i<20;i++){if((await read()).run)break;await tap(90);await page.waitForTimeout(500);}
  await page.waitForFunction(()=>window.th05ReplayQA.read().run,null,{timeout:20000});
  await armDialog(page);
  report.entered=await read();console.log('entered',JSON.stringify(report.entered));
  if(process.env.TH05_DIALOG==='1')await passDialog(page);
  await tap(263,600);await tap(262,700);await tap(340,500);await tap(90,1600);
  await tap(256);await page.waitForFunction(()=>window.th05ReplayQA.read().state?.mode===2);
  const before=await read();await page.waitForTimeout(3000);const after=await read();
  assert.equal(before.state.frameReplay.frames,after.state.frameReplay.frames,'pause duration adds no game input frames');
  await tap(257);await page.waitForFunction(()=>window.th05ReplayQA.read().state?.mode===1);
  await tap(88);await page.waitForTimeout(2500);
  if(process.env.TH05_RECORD_MS||process.env.TH05_DIALOG==='1'){
   await page.waitForTimeout(Number(process.env.TH05_RECORD_MS||1000));report.beforeManualEnd=await read();
   await page.evaluate(()=>window.th05ReplayQA.finish());
  }else{
   await tap(256);await page.waitForFunction(()=>window.th05ReplayQA.read().state?.mode===2);await tap(264);await tap(257);
  }
  await page.waitForFunction(()=>window.th05ReplayQA.read().savePrompt,null,{timeout:10000});
  report.record=await read();const encoded=await page.evaluate(()=>window.th05ReplayQA.exportBase64());
  const file=path.join(__dirname,`../reports/game-input-replay-${language}.th05r`);fs.writeFileSync(file,Buffer.from(encoded,'base64'));report.fileBytes=fs.statSync(file).size;
  console.log('recorded',JSON.stringify(report.record.result),'bytes',report.fileBytes);
  if(process.env.TH05_CONTINUE==='1'){
   assert.notEqual(process.env.TH05_DIALOG,'1','lifecycle fixture uses normal exit hooks');
   const worker=page.workers().find(w=>w.url().includes('dosbox-worker'));
   const [download]=await Promise.all([page.waitForEvent('download'),page.click('#save-replay')]);
   assert.equal(download.suggestedFilename(),'th05-solo.th05r');
   await page.waitForFunction(()=>!window.th05ReplayQA.read().savePrompt&&!window.th05ReplayQA.read().state?.paused);
   async function nextRun(){
    for(let i=0;i<20;i++){
     const r=await read();if(r.run&&!r.result&&r.state?.frameReplay.started&&!r.state.frameReplay.done)break;
     await tap(90);await page.waitForTimeout(500);
    }
    await page.waitForFunction(()=>window.th05ReplayQA.read().run&&!window.th05ReplayQA.read().result&&window.th05ReplayQA.read().state?.frameReplay.started&&!window.th05ReplayQA.read().state?.frameReplay.done);
    assert.equal(page.workers().find(w=>w.url().includes('dosbox-worker')),worker,'same emulator remains active after saving');
    await page.waitForTimeout(1500);
   }
   await nextRun();
   const beforeMove=await read();await page.locator('#canvas').focus();await page.keyboard.press('ArrowLeft',{delay:500});await page.waitForTimeout(200);const moved=await read();assert.notEqual(moved.state.x,beforeMove.state.x,'new run accepts live movement after export');
   await page.evaluate(()=>window.th05ReplayQA.finish());await page.waitForFunction(()=>window.th05ReplayQA.read().savePrompt);
   report.secondRun=await read();assert(report.secondRun.result.frames>0,'next run has its own recorded inputs');
   await page.click('#discard-replay');await page.waitForFunction(()=>!window.th05ReplayQA.read().state?.paused);
   const x=(await read()).state.x;await page.locator('#canvas').focus();await page.keyboard.press('ArrowRight',{delay:500});await page.waitForTimeout(200);assert.notEqual((await read()).state.x,x,'discard resumes live control in the current stage');
   await tap(256);await page.waitForFunction(()=>window.th05ReplayQA.read().state?.mode===2);await tap(264);await tap(257);
   await nextRun();await page.waitForTimeout(1000);await page.evaluate(()=>window.th05ReplayQA.finish());
   await page.waitForFunction(()=>window.th05ReplayQA.read().savePrompt);report.thirdRun=await read();
   assert(report.thirdRun.result.frames>0,'third run records after discarding the previous run');
   const third=await page.evaluate(()=>window.th05ReplayQA.exportBase64());
   fs.writeFileSync(path.join(__dirname,`../reports/game-input-replay-next-run-${language}.th05r`),Buffer.from(third,'base64'));
   await page.evaluate(()=>window.th05ReplayQA.play());
   await page.waitForFunction(()=>window.th05ReplayQA.read().result||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:60000});
   report.thirdRunPlayback=await read();
   assert.equal(report.thirdRunPlayback.result?.matches,true,'automatically recorded later runs must replay from a fresh emulator');
   await page.evaluate(()=>window.th05ReplayQA.close());await page.setInputFiles('#file',file);await page.click('#play');
   await page.waitForFunction(()=>window.th05ReplayQA.read().state?.frameReplay,null,{timeout:45000});
  }else await page.evaluate(()=>window.th05ReplayQA.play());
  await armDialog(page);if(process.env.TH05_DIALOG==='1')await passDialog(page);
  await page.waitForFunction(()=>window.th05ReplayQA.read().result||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:90000});
  await page.waitForTimeout(150);
  report.playback=await read();report.status=await page.locator('#status').innerText();console.log('played',JSON.stringify(report.playback),report.status);
  assert.equal(await page.locator('#end-dialog').isVisible(),true,'EOF shows a completion dialog instead of appearing frozen');
  assert.match(await page.locator('#end-summary').innerText(),/正常结束/);
  assert.equal(report.playback.result?.matches,true,report.status);assert.deepEqual(errors,[]);
  assert.equal(report.playback.state.x,report.playback.result.state.x,'EOF stops at the checked player position');
  assert.equal(report.playback.state.y,report.playback.result.state.y,'EOF must not execute one extra player update');
  assert(report.fileBytes<10000,'short sample must be much smaller than clock trace');
  assert.equal(report.playback.state.nativePaused,false,'recorded native pause menu is not replayed');
  assert.equal(report.playback.state.frameReplay.clockBytes,0,'no startup or runtime clock tape');
  assert.equal(report.playback.musicError,undefined);
  assert(report.playback.state.frameReplay.mutedAudioPackets>0,'hidden playback boot audio is discarded before output');
  await page.click('#end-replay');
  assert.equal(await page.locator('#end-dialog').isVisible(),false,'ending playback closes its completion dialog');
  assert.equal(await page.locator('#file').isEnabled(),true,'ending playback enables importing another file');
  assert.equal((await read()).mode,null,'ending playback releases the emulator');
  const imported=await page.context().newPage({viewport:{width:1100,height:1100}});imported.on('pageerror',e=>errors.push(e.message));
  await imported.goto((process.env.TH05_URL||'http://127.0.0.1:9877')+'/solo-replay.html?qa=1');
  await imported.setInputFiles('#file',file);await imported.waitForFunction(()=>!document.getElementById('play').disabled);await imported.click('#play');
  await armDialog(imported);if(process.env.TH05_DIALOG==='1')await passDialog(imported);
  await imported.waitForFunction(()=>window.th05ReplayQA.read().state?.frameReplay.frames>60,null,{timeout:45000});
  await imported.locator('#canvas').focus();await imported.keyboard.press('Escape');await imported.waitForTimeout(200);
  const paused=await imported.evaluate(()=>window.th05ReplayQA.read());await imported.waitForTimeout(700);
  assert.equal((await imported.evaluate(()=>window.th05ReplayQA.read())).state.frameReplay.frames,paused.state.frameReplay.frames);
  await imported.locator('#canvas').focus();await imported.keyboard.press('ArrowLeft',{delay:100});await imported.keyboard.press('Space');
  await imported.waitForFunction(()=>window.th05ReplayQA.read().result||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:90000});
  await imported.waitForTimeout(150);
  report.imported=await imported.evaluate(()=>window.th05ReplayQA.read());report.importStatus=await imported.locator('#status').innerText();
  assert.equal(report.imported.result?.matches,true,report.importStatus);assert.deepEqual(errors,[]);
  assert.equal(report.imported.state.x,report.imported.result.state.x);assert.equal(report.imported.state.y,report.imported.result.state.y);
  await imported.screenshot({path:path.join(__dirname,`../reports/game-input-replay-${language}.png`)});
  await imported.keyboard.press('Escape');
  assert.equal(await imported.locator('#end-dialog').isVisible(),false,'Escape dismisses completion through the same cleanup path');
  assert.equal(await imported.locator('#file').isEnabled(),true,'Escape after completion enables importing another file');
  await imported.close();
  console.log('PASS',language,'game input replay, pause excluded, game checks match; bytes',report.fileBytes);
 }finally{await page.screenshot({path:path.join(__dirname,`../reports/game-input-replay-last-${language}.png`)}).catch(()=>{});report.final=await read().catch(()=>null);report.status=await page.locator('#status').innerText().catch(()=>null);fs.writeFileSync(path.join(__dirname,`../reports/game-input-replay-${language}.json`),JSON.stringify({...report,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
