// No server: map browser requests directly to frozen local web resources.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const language=process.env.TH05_LANGUAGE||'cn',profile=process.env.TH05_ENDING||'good';
 assert(['good','bad','extra'].includes(profile));
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1100,height:1200}}),errors=[],report={language,profile};
 const web=path.resolve(__dirname,'../web'),prefix=path.resolve(__dirname,`../reports/replay-ending-${language}-${profile}`);
 await context.addInitScript(()=>{
  const add=Worklet.prototype.addModule;
  Worklet.prototype.addModule=async function(url,options){const r=await fetch(url),blob=URL.createObjectURL(new Blob([await r.text()],{type:'text/javascript'}));try{return await add.call(this,blob,options);}finally{URL.revokeObjectURL(blob);}};
 });
 await context.route('http://127.0.0.1:9877/**',async route=>{
  const file=path.resolve(web,'.'+decodeURIComponent(new URL(route.request().url()).pathname));
  if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
  const types={'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm'};
  return route.fulfill({path:file,contentType:types[path.extname(file)]||'application/octet-stream'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const read=()=>page.evaluate(()=>window.th05ReplayQA.read());
 async function advanceToScore(target,record){
  const qa=()=>target.evaluate(()=>window.th05ReplayQA.read());
  await target.waitForFunction(()=>window.th05ReplayQA.read().state?.frameReplay.phase==='ending'||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:60000});
  assert.equal((await qa()).state?.frameReplay.phase,'ending',await target.locator('#status').innerText());
  const endingStarted=Date.now(); // No dialogue keys: presentation must skip itself.
  await target.bringToFront();await target.locator('#canvas').focus();
  const timer=setInterval(async()=>{try{
   const r=await qa();console.log('waiting',record?'record':'playback',r.state?.frameReplay,r.state?.program);
   if(process.env.TH05_ENDING_DEBUG==='1'){
    const worker=target.workers().find(w=>w.url().includes('dosbox-worker'));
    console.log('native ending',await worker.evaluate(()=>{
     const h=mod.HEAPU8,v=new DataView(h.buffer),out=[];
     for(let at=h.indexOf(0xe8);at>=0;at=h.indexOf(0xe8,at+1)){
      if(h[at+1]!==0x4b||h[at+2]!==0xfb||h[at+3]!==0x9c||h[at+4]!==0x81||h[at+5]!==0xfe)continue;
      const image=at-0xe800,ds=v.getUint16(image+1,true),musicSegment=v.getUint16(musicReader.at+16,true),base=musicReader.at-musicReader.patch.mailbox_com_offset-musicSegment*16;
      if(image<base||image>base+0xa0000)continue;
      const d=base+ds*16;
      out.push({image,ds,values:Array.from({length:6},(_,i)=>v.getInt16(d+0x4f0e+i*2,true))});
     }
     return out;
    }));
   }
   await target.screenshot({path:prefix+'-progress.png'});
  }catch(e){console.log('progress',e.message);}},30000);
  try{await target.waitForFunction(record?()=>window.th05ReplayQA.read().savePrompt||document.getElementById('status').textContent.startsWith('实验停止'):()=>window.th05ReplayQA.read().result||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:Number(process.env.TH05_ENDING_TIMEOUT||300000)});}finally{clearInterval(timer);}
  const elapsed=Date.now()-endingStarted;
  assert(elapsed<30000,`direct score should not wait for credits: ${elapsed} ms`);
  console.log('direct score',record?'record':'playback',elapsed,'ms');
  const result=await qa();
  assert(result.result?.ending,await target.locator('#status').innerText());
  assert.equal(result.result.ending.sequence,{good:255,bad:254,extra:253}[profile]);
  assert.equal(result.result.ending.endpoint,'score');
  assert.equal(result.result.frames,120,'test uses exactly 120 actual battle inputs before native clear');
  return result;
 }
 try{
  await page.goto('http://127.0.0.1:9877/solo-replay.html?qa=1');
  await page.selectOption('#language',language);await page.selectOption('#test-case',profile);await page.click('#record');
  await page.waitForFunction(()=>window.th05ReplayQA.read().state||document.getElementById('status').textContent.startsWith('实验停止'),null,{timeout:45000});
  for(let i=0;i<25;i++){
   if((await read()).run)break;
   await page.locator('#canvas').focus();await page.keyboard.press('KeyZ',{delay:150});await page.waitForTimeout(350);
  }
  console.log('started',language,profile,await page.locator('#status').innerText());
  report.record=await advanceToScore(page,true);
  await page.locator('#canvas').screenshot({path:prefix+'-score.png'});
  const encoded=await page.evaluate(()=>window.th05ReplayQA.exportBase64()),file=prefix+'.th05r';
  fs.writeFileSync(file,Buffer.from(encoded,'base64'));report.bytes=fs.statSync(file).size;
  console.log('recorded',JSON.stringify(report.record.result));
  await page.click('#discard-replay');
  await page.waitForTimeout(3500);
  assert.equal(await page.locator('#save-dialog').isVisible(),false);
  await page.locator('#canvas').screenshot({path:prefix+'-resumed.png'});
  await page.evaluate(()=>window.th05ReplayQA.close());
  await page.setInputFiles('#file',file);await page.click('#play');
  report.playback=await advanceToScore(page,false);
  assert.equal(report.playback.result.matches,true,'battle and final resident score state must both match');
  assert.equal(await page.locator('#end-dialog').isVisible(),true);
  assert.match(await page.locator('#end-summary').innerText(),/通关成绩／评价画面/);
  assert.match(await page.locator('#end-summary').innerText(),/结算流程测试录像/);
  await page.screenshot({path:prefix+'-playback.png'});
  await page.click('#end-replay');assert.equal(await page.locator('#file').isEnabled(),true);
  assert.deepEqual(errors,[]);console.log('PASS',language,profile,report.bytes,'bytes');
 }finally{
  report.final=await read().catch(()=>null);report.status=await page.locator('#status').innerText().catch(()=>null);
  await page.screenshot({path:prefix+'-last.png'}).catch(()=>{});
  fs.writeFileSync(prefix+'.json',JSON.stringify({...report,errors},null,2));await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
