// Real solo page/core, in-process resource routes only; no listening server.
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const web=path.resolve(__dirname,'../web'),reports=path.resolve(__dirname,'../reports'),language=process.env.TH05_LANGUAGE||'cn';
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1100,height:1100},acceptDownloads:true}),page=await context.newPage(),errors=[],report={language};
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{const add=Worklet.prototype.addModule;Worklet.prototype.addModule=async function(url,options){const r=await fetch(url),blob=URL.createObjectURL(new Blob([await r.text()],{type:'text/javascript'}));try{return await add.call(this,blob,options);}finally{URL.revokeObjectURL(blob);}};});
 await context.route('http://127.0.0.1:9877/**',route=>{
  const file=path.resolve(web,'.'+new URL(route.request().url()).pathname);
  if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({path:file,contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'});
 });
 const read=()=>page.evaluate(()=>th05ReplayQA.read());
 async function tap(code){await page.evaluate(code=>th05ReplayQA.key(code,true),code);await page.waitForTimeout(110);await page.evaluate(code=>th05ReplayQA.key(code,false),code);}
 async function enter(){for(let i=0;i<60;i++){if((await read()).run)return;await tap(90);await page.waitForTimeout(300);}throw Error('native game did not enter a stage');}
 async function boot(){await page.selectOption('#language',language);await page.click('#record');await page.waitForFunction(()=>th05ReplayQA.read().state,null,{timeout:60000});await enter();}
 try{
  await context.addInitScript(()=>{localStorage.setItem('th04.touch.enabled','true');localStorage.setItem('th04.touch.mode','limited');});
  await page.goto('http://127.0.0.1:9877/solo.html?qa=1');await boot();
  await page.waitForFunction(()=>th05ReplayQA.read().state?.mode===1&&!th05ReplayQA.read().state?.flags);
  await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.frames>125);
  const before=await read(),box=await page.locator('.touch-surface').boundingBox();
  assert(box&&box.width>0,'drag surface has actual geometry');
  const x=box.x+box.width*.45,y=box.y+box.height*.65;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+80,y-50,{steps:24});await page.waitForTimeout(400);await page.mouse.up();
  await page.waitForTimeout(300);const moved=await read();
  assert(Math.hypot(moved.state.x-before.state.x,moved.state.y-before.state.y)>4,'limited pointer drag moves the native player');
  await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.frames>360);
  await page.evaluate(()=>th05ReplayQA.finish());await page.locator('#save-dialog').waitFor({state:'visible'});
  const bytes=await page.evaluate(async()=>Array.from(Uint8Array.from(atob(await th05ReplayQA.exportBase64()),c=>c.charCodeAt(0))));
  const parsed=await page.evaluate(async bytes=>{const {decodeFrameReplay,FRAME_STRIDE}=await import('/frame-replay-codec.js');const r=await decodeFrameReplay(new Blob([Uint8Array.from(bytes)]));return {frames:r.header.frames,version:r.header.version,touchFrames:Array.from({length:r.header.frames},(_,i)=>r.inputs[i*FRAME_STRIDE+1]).filter(Boolean).length};},bytes);
  assert(parsed.touchFrames>0,'touch mailbox states are present in the file');report.record={before:before.state,moved:moved.state,...parsed};
  await page.click('#discard-replay');await page.click('#stop');
  const file=path.join(reports,'solo-drag-'+language+'.th05r');fs.writeFileSync(file,Buffer.from(bytes));
  await page.setInputFiles('#file',file);await page.click('#play');
  assert.equal(await page.isDisabled('[data-unlimited]'),true,'playback locks unlimited movement');
  const worker=()=>page.workers().find(w=>w.url().includes('dosbox-worker'));
  await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.started||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:60000});
  await worker().evaluate(()=>onmessage({data:{type:'input',input:{generation:soloInput.snapshot?.generation,touch:{active:true,unlimited:true,x:8191,y:8191}}}}));
  await page.waitForFunction(()=>th05ReplayQA.read().result||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:90000});
  report.playback=await read();assert.equal(report.playback.result?.matches,true,await page.locator('#status').innerText());
  await page.click('#end-replay');await boot();
  await page.click('.touch-help-open');await page.check('[data-unlimited]');await page.click('.touch-layout-editor [data-close]');await page.waitForFunction(()=>th05ReplayQA.read().tainted);
  await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.unlimited===true);
  assert.equal((await read()).hasStore,false);assert.equal((await read()).hasRecording,false);
  await page.click('.touch-help-open');await page.uncheck('[data-unlimited]');await page.click('.touch-layout-editor [data-close]');await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.unlimited===false);
  assert.equal((await read()).tainted,true,'switching back to limited cannot salvage the run');
  await tap(256);await page.waitForFunction(()=>th05ReplayQA.read().state?.mode===2);await page.waitForTimeout(600);await tap(264);await page.waitForTimeout(300);await tap(257);
  await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.done);
  for(let i=0;i<60;i++){if((await read()).run&&!(await read()).tainted)break;await tap(90);await page.waitForTimeout(300);}
  assert.equal((await read()).tainted,false,'next native run after turning unlimited off records again');assert.equal((await read()).hasStore,true);
  assert.deepEqual(errors,[]);console.log('PASS limited drag movement, six-byte input file, fresh-core exact replay, live-input isolation, unlimited sticky taint and clean next run',language,parsed);
 }finally{report.errors=errors;report.final=await read().catch(()=>null);await page.screenshot({path:path.join(reports,'solo-touch-last-'+language+'.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(reports,'solo-replay-touch-'+language+'.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
