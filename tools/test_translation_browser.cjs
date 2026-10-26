const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),port=19924,results=[];
let server,browser;
(async()=>{try{
 server=spawn('python',['-u','lan_server.py','--bind','127.0.0.1','--port',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.stdout.once('data',resolve);});
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 for(const mode of (process.argv.includes('--ending')?['bad','good','extra']:['solo','local'])){
  const context=await browser.newContext({viewport:{width:1100,height:950}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const ending=['bad','good','extra'].includes(mode),solo=mode==='solo'||ending;
  if(ending)await context.addInitScript(({base64,patch})=>{
   const Parent=Worker;
   window.Worker=class extends Parent{postMessage(data,transfer){
    if(data.type==='boot'){
     const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
     data.files.find(f=>f.path==='game/KAIKI/MAIN.EXE').contents=bytes;
     data.patch=patch;
     transfer.push(bytes.buffer);
    }
    return super.postMessage(data,transfer);
   }};
  },{base64:fs.readFileSync(path.join(root,`build/translation-${mode}.exe`)).toString('base64'),patch:JSON.parse(fs.readFileSync(path.join(root,`build/translation-${mode}.json`)))});
  await page.goto(`http://127.0.0.1:${port}/${solo?'solo-original':'local'}.html?qa=1`);
  await page.selectOption('#language','cn');
  const ready=page.waitForEvent('worker',{predicate:w=>w.url().includes('dosbox-worker')});
  await page.click('#start');const worker=await ready;
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('运行中'),null,{timeout:60000});
  const tap=async key=>{await worker.evaluate(()=>ci.sendKeyEvent(90,true));await page.waitForTimeout(300);await worker.evaluate(()=>ci.sendKeyEvent(90,false));await page.waitForTimeout(500);};
  if(solo){
   for(let i=0;i<40;i++){
    if(await worker.evaluate(()=>soloInput?.snapshot?.mode===1))break;
    await tap('z');
   }
   await page.waitForFunction(()=>document.getElementById('status').textContent.includes('运行中'));
  }else{
   await page.waitForFunction(()=>th05QA.readState()?.ticks>20,null,{timeout:60000});
   await worker.evaluate(()=>{input.invincible=true;inputs();});
  }
  await page.waitForTimeout(3000);
  if(ending){
   await page.locator('#canvas').screenshot({path:path.join(root,`reports/translation-${mode}-before.png`)});
   for(let i=0;i<20;i++){
    await page.waitForTimeout(1500);
    await page.locator('#canvas').screenshot({path:path.join(root,`reports/translation-${mode}-sequence-${i}.png`)});
    if(i>5)await tap('z');
   }
  }
  const diagnostic=await worker.evaluate(()=>({state:state(),logs,files:mod.FS.readdir('/home/web_user/game'),config:mod.FS.readFile('/home/web_user/.jsdos/dosbox.conf',{encoding:'utf8'})})).catch(async()=>worker.evaluate(()=>({state:state(),logs})));
  assert.equal(errors.length,0,JSON.stringify(errors));
  await page.locator('#canvas').screenshot({path:path.join(root,`reports/translation-${mode}.png`)});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#canvas').screenshot({path:path.join(root,`reports/translation-${mode}-mobile.png`)});
  results.push({mode,diagnostic,errors,visualReviewRequired:ending});console.log(ending?'CAPTURE ending for visual review':'PASS translation browser',mode);
  await context.close();
 }
}finally{
 fs.writeFileSync(path.join(root,process.argv.includes('--ending')?'reports/translation-ending-browser.json':'reports/translation-browser.json'),JSON.stringify(results,null,2)+'\n');await browser?.close();server?.kill();
}})().catch(e=>{console.error(e);process.exitCode=1;});
