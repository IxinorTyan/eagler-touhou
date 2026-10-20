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
 async function enter(){for(let i=0;i<30;i++){if((await read()).run)return;await tap(90);await page.waitForTimeout(300);}throw Error('native game did not enter a stage');}
 async function boot(){await page.selectOption('#language',language);await page.click('#record');await page.waitForFunction(()=>th05ReplayQA.read().state,null,{timeout:60000});await enter();}
 try{
  await page.goto('http://127.0.0.1:9877/solo.html?qa=1');await boot();
  await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.frames>120);
  await page.locator('#canvas').focus();await page.keyboard.down('KeyZ');await page.evaluate(()=>th05ReplayQA.finish());
  await page.locator('#save-dialog').waitFor({state:'visible'});
  await page.keyboard.press('Enter');assert.equal((await read()).savePrompt,true,'held gameplay Z blocks accidental menu confirmation');
  await page.keyboard.up('KeyZ');await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#discard-replay').getAttribute('data-selected'),'true');
  await page.keyboard.press('ArrowLeft');await page.evaluate(()=>document.fonts.ready);
  await page.locator('#save-dialog').screenshot({path:path.join(reports,'solo-save-menu-'+language+'.png')});
  await page.setViewportSize({width:390,height:850});await page.waitForTimeout(100);
  await page.screenshot({path:path.join(reports,'solo-save-mobile-'+language+'.png'),fullPage:true});
  await page.setViewportSize({width:1100,height:1100});
  const download=page.waitForEvent('download');await page.keyboard.press('Enter');const file=path.join(reports,'solo-ui-'+language+'.th05r');await(await download).saveAs(file);
  assert.equal((await read()).savePrompt,false);assert.equal((await read()).hasRecording,true);
  // An enabling cheat destroys even a previously sealed, still resident file.
  await page.check('#invincible');report.cheated=await read();assert.equal(report.cheated.hasRecording,false);assert.equal(report.cheated.hasStore,false);assert.equal(report.cheated.bytes,0);
  await page.uncheck('#invincible');assert.equal((await read()).tainted,true);assert.equal(await page.isDisabled('#download'),true);
  await page.click('#stop');await boot();assert.equal((await read()).tainted,false,'fresh run after disabling cheat records again');
  await page.check('#invincible');
  await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.cheat===true);
  const worker=page.workers().find(w=>w.url().includes('dosbox-worker'));
  const invulnerable=await worker.evaluate(()=>{const s=soloInput.snapshot,d=s.at-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;return mod.HEAPU8[d+0x36d0+30];});
  assert(invulnerable>0,'native invulnerability is actually refreshed');
  await page.uncheck('#invincible');await page.evaluate(()=>th05ReplayQA.finish());await page.waitForTimeout(300);
  assert.equal((await read()).savePrompt,false);assert.equal((await read()).hasStore,false);
  // Exit the tainted run through the actual native menu, then start clean in-place.
  await tap(256);await page.waitForFunction(()=>th05ReplayQA.read().state?.mode===2);
  await page.waitForTimeout(600);await tap(264);await page.waitForTimeout(300);
  await page.locator('#canvas').screenshot({path:path.join(reports,'solo-cheat-pause-'+language+'.png')});
  await tap(257);await page.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay.done);
  for(let i=0;i<30;i++){if((await read()).run&&!((await read()).tainted))break;await tap(90);await page.waitForTimeout(300);}
  assert.equal((await read()).tainted,false);assert.equal((await read()).hasStore,true);
  await page.click('#stop');await page.setInputFiles('#file',file);await page.click('#play');
  assert.equal(await page.isDisabled('#invincible'),true,'playback disallows cheats');
  await page.waitForFunction(()=>th05ReplayQA.read().result||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:90000});
  report.playback=await read();assert.equal(report.playback.result?.matches,true,await page.locator('#status').innerText());
  await page.locator('#end-dialog').screenshot({path:path.join(reports,'solo-end-menu-'+language+'.png')});
  await page.click('#end-replay');assert.equal((await read()).mode,null);assert.deepEqual(errors,[]);
  await page.check('#invincible');await boot();
  assert.equal((await read()).hasStore,false,'a run started with cheat enabled never creates a recorder');
  assert.equal((await read()).hasRecording,false);assert.equal(await page.isDisabled('#play'),true);
  await page.click('#stop');await page.uncheck('#invincible');
  console.log('PASS integrated solo, pixel menu, held-key guard, download, sticky cheat rejection, native next run and fresh replay',language);
 }finally{report.errors=errors;report.final=await read().catch(()=>null);await page.screenshot({path:path.join(reports,'solo-ui-last-'+language+'.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(reports,'solo-replay-ui-'+language+'.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
