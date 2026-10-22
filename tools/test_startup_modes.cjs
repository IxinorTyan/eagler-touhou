const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),port=19896,base=`http://127.0.0.1:${port}`,results=[];
let server,browser;
(async()=>{try{
 server=spawn('python',['lan_server.py','--bind','127.0.0.1','--port',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','ignore']});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.stdout.once('data',resolve);});
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 for(const test of [{solo:true,language:'cn',audio:'original'},{solo:true,language:'jp',audio:'independent'},{solo:false,language:'jp',extra:true},{solo:false,language:'cn',noCache:true}]){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(test.noCache)await context.addInitScript(()=>Object.defineProperty(globalThis,'indexedDB',{value:null}));
  await page.goto(base+(test.solo?'/solo.html':'/local.html?qa=1'));
  await page.selectOption('#language',test.language);
  if(test.solo)await page.selectOption('#audio-mode',test.audio);
  else{await page.selectOption('#players',test.extra?'3':'2');if(test.extra)await page.selectOption('#rank','4');}
  const workerReady=page.waitForEvent('worker',{predicate:w=>w.url().includes('dosbox-worker'),timeout:10000});
  await page.click('#start');
  const worker=await workerReady;
  if(test.solo){
   await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('原版单人运行中'),null,{timeout:60000});
   let ready=false;for(let i=0;i<600;i++){
    ready=await worker.evaluate(()=>typeof mod!=='undefined'&&ci&&state()?.program==='OP'&&frames>15);
    if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));
   }assert(ready,'original OP startup');
  }else await page.waitForFunction(()=>th05QA.readState()?.ticks>30,null,{timeout:60000});
  const state=await worker.evaluate(()=>({...state(),locator:gameLocator.metrics,cpu:mod.UTF8ToString(mod._getCPUMetrics())}));
  assert.equal(errors.length,0,JSON.stringify(errors));if(test.extra){assert.equal(state.stage,6);assert.equal(state.rank,4);}if(!test.solo)assert.equal(state.players.length,test.extra?3:2);
  results.push({test,state,errors});console.log('PASS startup',test,state.program||state.stage);
  await context.close();
 }
}finally{
 fs.writeFileSync(path.join(root,'reports/startup-modes.json'),JSON.stringify(results,null,2)+'\n');await browser?.close();server?.kill();
}})().catch(e=>{console.error(e);process.exitCode=1;});
