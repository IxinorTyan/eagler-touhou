const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base=process.env.TH05_URL||'http://127.0.0.1:9876';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')console.log('console',m.text().slice(0,700));});
 const report={};
 try{
  await page.goto(base+'/solo-clock-replay.html?qa=1');
  await page.selectOption('#language',process.env.TH05_LANGUAGE||'cn');await page.click('#record');
  await page.waitForFunction(()=>window.th05ReplayQA.read().state?.program==='OP',null,{timeout:45000});
  const read=()=>page.evaluate(()=>window.th05ReplayQA.read());
  const tap=async(code,ms=200)=>{await page.evaluate(code=>window.th05ReplayQA.key(code,true),code);await page.waitForTimeout(ms);await page.evaluate(code=>window.th05ReplayQA.key(code,false),code);await page.waitForTimeout(350);};
  assert.equal((await read()).run,null,'title is not a recorded run');
  assert.equal(await page.locator('#finish').isDisabled(),true);
  await page.evaluate(()=>window.th05ReplayQA.finish());await page.waitForTimeout(250);
  assert.equal((await read()).result,null,'ending at title is ignored');
  for(let i=0;i<20;i++){
   if((await read()).state?.mode===1)break;
   await tap(90);await page.waitForTimeout(500);
  }
  await page.waitForFunction(()=>window.th05ReplayQA.read().state?.mode===1,null,{timeout:20000});
  report.entered=await read();console.log('entered',JSON.stringify(report.entered.state));
  assert(report.entered.run?.startBoundary>0,'stage entry automatically starts the run');
  await tap(263,550);await tap(262,700);await tap(340,400);await tap(90,1000);
  await tap(256);await page.waitForFunction(()=>window.th05ReplayQA.read().state?.mode===2,null,{timeout:6000});
  await tap(257);await page.waitForFunction(()=>window.th05ReplayQA.read().state?.mode===1,null,{timeout:6000});
  await tap(88);await page.waitForTimeout(1500);
  // End through the actual native pause menu, with no manual recorder action.
  await tap(256);await page.waitForFunction(()=>window.th05ReplayQA.read().state?.mode===2);
  await tap(264);await tap(257);
  await page.waitForFunction(()=>window.th05ReplayQA.read().result,null,{timeout:10000});
  report.record=await read();console.log('recorded',JSON.stringify(report.record.result));
  assert.equal(report.record.savePrompt,true,'leaving the run prompts for saving');
  assert.notEqual(report.record.result.guestHash,'unavailable');
  const saved=await page.evaluate(()=>window.th05ReplayQA.exportBase64()),language=process.env.TH05_LANGUAGE||'cn';
  const file=path.join(root,`reports/external-replay-test-${language}.th05r`);fs.writeFileSync(file,Buffer.from(saved,'base64'));
  report.fileBytes=fs.statSync(file).size;
  await page.locator('#canvas').screenshot({path:path.join(root,'reports/external-replay-record.png')});
  const downloadEvent=page.waitForEvent('download');await page.click('#save-replay');
  const downloaded=await downloadEvent;assert.equal(downloaded.suggestedFilename(),'th05-solo-external.th05r');
  assert.equal((await read()).savePrompt,false);
  assert.equal(await page.locator('#record').isEnabled(),true,'save permits a new game');
  await page.evaluate(()=>window.th05ReplayQA.play());
  await page.waitForFunction(()=>window.th05ReplayQA.read().result||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:90000});
  report.playback=await read();report.status=await page.locator('#status').innerText();report.errors=errors;
  console.log('playback',JSON.stringify(report.playback.result),report.status);
  await page.locator('#canvas').screenshot({path:path.join(root,'reports/external-replay-playback.png')});
  assert.equal(report.playback.result?.matches,true,report.status);assert.deepEqual(errors,[]);
  // A new page imports the real file, with an unrelated pause and live input.
  const imported=await browser.newPage({viewport:{width:1100,height:1000}});
  imported.on('pageerror',e=>errors.push(e.stack));
  await imported.goto(base+'/solo-clock-replay.html?qa=1');await imported.setInputFiles('#file',file);await imported.waitForFunction(()=>!document.getElementById('play').disabled);
  await imported.click('#play');await imported.waitForFunction(()=>window.th05ReplayQA.read().state?.externalReplay?.boundary>30);
  await imported.click('#hold');await imported.waitForTimeout(200);
  const before=await imported.evaluate(()=>window.th05ReplayQA.read());await imported.waitForTimeout(400);
  const after=await imported.evaluate(()=>window.th05ReplayQA.read());assert.equal(before.state.externalReplay.boundary,after.state.externalReplay.boundary);
  await imported.locator('#canvas').focus();await imported.keyboard.press('ArrowLeft',{delay:150});
  await imported.click('#hold');
  await imported.waitForFunction(()=>window.th05ReplayQA.read().result||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:90000});
  report.imported=await imported.evaluate(()=>window.th05ReplayQA.read());report.importStatus=await imported.locator('#status').innerText();
  assert.equal(report.imported.result?.matches,true,report.importStatus);assert.deepEqual(errors,[]);
  console.log('imported PASS',language,'bytes',report.fileBytes,'SHA',report.imported.result.guestSha256);await imported.close();
 }finally{fs.writeFileSync(path.join(root,`reports/external-replay-browser-${process.env.TH05_LANGUAGE||'cn'}.json`),JSON.stringify(report,null,2)+'\n');await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
