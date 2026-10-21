// Generate an archived-format fixture in an isolated QA route, then exercise
// the unmodified production playback-only page in another browser context.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),base='http://127.0.0.1:9877';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),report={errors:[]};
 async function setup(fixture){
  const context=await browser.newContext();await context.addInitScript(()=>globalThis.AudioWorkletNode=undefined);
  await context.route(base+'/**',route=>{
   const name=decodeURIComponent(new URL(route.request().url()).pathname),file=path.resolve(web,'.'+name);
   if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   if(fixture&&name==='/solo-frame-replay.js'){
    let source=fs.readFileSync(file,'utf8');
    source=source.replace("if(!playback){status('此入口只播放旧格式录像；录制请返回单人游戏。');return;}",'');
    source=source.replace('createFastCore({canvas,disk,patch,solo:true','createFastCore({canvas,disk,patch,qa:true,solo:true');
    return route.fulfill({body:source,contentType:'text/javascript'});
   }
   return route.fulfill({path:file,contentType:({'.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});
  });return context;
 }
 try{
  const source=await (await setup(true)).newPage();source.on('pageerror',e=>report.errors.push(e.message));
  await source.goto(base+'/solo-legacy-replay.html?qa=1');await source.evaluate(()=>th05ReplayQA.start());
  const read=()=>source.evaluate(()=>th05ReplayQA.read());
  for(let n=0;n<35&&!(await read()).run;n++){
   await source.evaluate(()=>th05ReplayQA.key(90,true));await source.waitForTimeout(200);
   await source.evaluate(()=>th05ReplayQA.key(90,false));await source.waitForTimeout(400);
  }
  await source.waitForFunction(()=>th05ReplayQA.read().state?.frameReplay?.frames>120,null,{timeout:30000});
  await source.evaluate(()=>th05ReplayQA.finish());await source.waitForFunction(()=>th05ReplayQA.read().savePrompt,null,{timeout:20000});
  const data=await source.evaluate(()=>th05ReplayQA.exportBase64()),file=path.join(root,'reports/legacy-playback-fixture.th05r');fs.writeFileSync(file,Buffer.from(data,'base64'));
  report.record=await read();await source.close();
  const viewer=await (await setup(false)).newPage();viewer.on('pageerror',e=>report.errors.push(e.message));
  await viewer.goto(base+'/solo-legacy-replay.html?qa=1');assert(await viewer.locator('#record').isDisabled());
  await viewer.setInputFiles('#file',file);await viewer.click('#play');
  await viewer.waitForFunction(()=>th05ReplayQA.read().result||document.querySelector('#status').textContent.includes('实验停止'),null,{timeout:60000});
  report.playback=await viewer.evaluate(()=>th05ReplayQA.read());report.status=await viewer.locator('#status').innerText();
  assert.equal(report.playback.result?.matches,true,report.status);assert.deepEqual(report.errors,[]);report.passed=true;
  console.log('PASS legacy game-frame file plays on the production playback-only page');
 }finally{fs.writeFileSync(path.join(root,'reports/legacy-browser-playback.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
