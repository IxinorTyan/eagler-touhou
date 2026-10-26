// Lifecycle checks on the real core. Stage advance is explicitly injected;
// this scenario must never be used as a deterministic replay proof.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage(),report={},errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto((process.env.TH05_URL||'http://127.0.0.1:9877')+'/solo-clock-replay.html?qa=1');
  await page.click('#record');
  const read=()=>page.evaluate(()=>window.th05ReplayQA.read());
  const tap=async code=>{await page.evaluate(c=>window.th05ReplayQA.key(c,true),code);await page.waitForTimeout(200);await page.evaluate(c=>window.th05ReplayQA.key(c,false),code);await page.waitForTimeout(500);};
  await page.waitForFunction(()=>window.th05ReplayQA.read().state?.mode===4,null,{timeout:90000});
  report.demo=await read();assert.equal(report.demo.run,null);assert.equal(report.demo.savePrompt,false);
  console.log('PASS: natural attract demo does not begin a recorded run');
  for(let i=0;i<24;i++){if((await read()).run)break;await tap(90);await page.waitForTimeout(500);}
  await page.waitForFunction(()=>window.th05ReplayQA.read().run&&window.th05ReplayQA.read().state?.mode===1);
  report.entered=await read();
  const worker=page.workers().find(w=>w.url().includes('dosbox-worker'));
  await worker.evaluate(()=>{
   const at=soloInput.at,d=at-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
   const v=new DataView(mod.HEAPU8.buffer),resident=replayGuestBase+v.getUint16(d+0x41fe,true)*16+v.getUint16(d+0x41fc,true);
   mod.HEAPU8[resident+0x13]=soloInput.snapshot.stage+1;
   mod.HEAPU8[d+0x576c]=2; // Original Q_NEXT_STAGE, test fixture only.
  });
  await page.waitForFunction(stage=>window.th05ReplayQA.read().state?.mode===1&&window.th05ReplayQA.read().state?.stage>stage,report.entered.state.stage,{timeout:30000});
  report.nextStage=await read();assert.equal(report.nextStage.result,null);assert.equal(report.nextStage.savePrompt,false);
  assert.deepEqual(report.nextStage.run,report.entered.run);
  console.log('PASS: original stage transition retains the same run and does not prompt');
  // Native quit is covered in both languages by test_external_replay.cjs.
  // Here exercise the optional early finish and the discard choice.
  await page.evaluate(()=>window.th05ReplayQA.finish());
  await page.waitForFunction(()=>window.th05ReplayQA.read().savePrompt,null,{timeout:10000});
  await page.click('#discard-replay');assert.equal((await read()).savePrompt,false);
  assert.equal(await page.locator('#download').isDisabled(),true);assert.equal(await page.locator('#record').isEnabled(),true);
  report.discarded=await read();assert.deepEqual(errors,[]);
  console.log('PASS: discard releases the session and permits another launch');
 }finally{fs.writeFileSync(path.join(__dirname,'../reports/external-replay-lifecycle.json'),JSON.stringify({...report,errors},null,2)+'\n');await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
