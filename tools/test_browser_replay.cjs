// Real player recording and independent playback, routed files, no listener.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),base='http://127.0.0.1:9877',language=process.env.TH05_LANGUAGE||'cn';
const fault=process.env.TH05_RECORD_FAULT==='1';
const reportStem=process.env.QA_REPORT_NAME||`browser-replay-${language}${fault?'-fault':''}`;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={date:new Date().toISOString(),language,fault,requests:[],errors:[]};
 async function setup(){
  const context=await browser.newContext({acceptDownloads:true});
  await context.route(base+'/**',route=>{
   const name=decodeURIComponent(new URL(route.request().url()).pathname);report.requests.push(name);
   const file=name==='/solo.js'&&process.env.QA_SOLO_SOURCE?path.resolve(process.env.QA_SOLO_SOURCE):path.resolve(web,'.'+name);
   if(name==='/solo.js'&&process.env.QA_SOLO_SOURCE)return route.fulfill({path:file,contentType:'text/javascript'});
   if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});
  });
  await context.addInitScript(()=>{
   // Routing cannot intercept AudioWorklet fetches; use existing audio fallback.
   globalThis.AudioWorkletNode=undefined;
   const AC=AudioContext;window.musicSources=[];globalThis.AudioContext=class extends AC{createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(...args)=>{if(source.buffer?.duration>5)musicSources.push(source);return start(...args);};return source;}};
   const NativeWorker=Worker;window.coreStates=[];window.coreBoots=[];window.coreWorkers=[];window.storageWorkers=[];
   window.Worker=class extends NativeWorker{
    constructor(url,...args){super(url,...args);if(String(url).includes('dosbox-worker'))coreWorkers.push(this);if(String(url).includes('external-replay-store-worker'))storageWorkers.push(this);this.addEventListener('message',({data})=>{if(data.type==='state')coreStates.push(data.state);if(coreStates.length>200)coreStates.shift();});}
    postMessage(data,...rest){if(data.type==='boot')coreBoots.push({frameReplay:!!data.frameReplay,externalReplay:data.externalReplay?.mode,qa:!!data.qa,solo:!!data.solo});return super.postMessage(data,...rest);}
   };
  });
  return context;
 }
 try{
  const players=await setup(),page=await players.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(base+'/solo.html');await page.selectOption('#language',language);await page.click('#start');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('运行中')||document.querySelector('#status').textContent.includes('失败'),null,{timeout:60000});
  assert.match(await page.locator('#status').innerText(),/原版单人运行中/);
  const read=()=>page.evaluate(()=>coreStates.at(-1));
  const tap=async(key,ms=150)=>{await page.locator('#canvas').focus();await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);await page.waitForTimeout(200);};
  for(let i=0;i<40;i++){if((await read())?.mode===1)break;await tap('z');await page.waitForTimeout(300);}
  await page.waitForFunction(()=>coreStates.at(-1)?.mode===1&&coreStates.at(-1)?.practice?.ready,null,{timeout:30000});
  report.entered=await read();assert.equal(report.entered.externalReplay.recording,true);
  assert.equal(report.entered.practice.mode,'full');assert.equal(report.entered.practice.waiting,false);assert.equal(report.entered.practice.options.lockPower,false);assert(report.entered.practice.lives>0);assert(report.entered.practice.bombs>0);
  // Record guarded helper events and verify them during independent playback.
  await page.locator('#canvas').focus();await page.keyboard.press('F1');await page.waitForTimeout(150);assert.equal((await read()).practice.options.invincible,false);
  await page.keyboard.press('Backspace');await page.keyboard.press('F1');await page.waitForFunction(()=>coreStates.at(-1)?.practice?.options.invincible);await page.keyboard.press('Backspace');await page.keyboard.press('F1');await page.waitForTimeout(150);assert.equal((await read()).practice.options.invincible,true);
  assert.deepEqual(await page.evaluate(()=>coreBoots),[{frameReplay:false,externalReplay:'record',qa:false,solo:true}]);
  if(process.env.TH05_BGM_SPEED_CHECKS){
   await page.waitForFunction(()=>{try{return musicSources.length>0&&/^本地音乐：st\d\d-/.test(JSON.parse(document.querySelector('#diagnostics').textContent).music);}catch{return false;}},null,{timeout:20000});report.musicSpeeds=[];
   const sample=()=>page.evaluate(()=>{const s=musicSources.at(-1);return {sources:musicSources.length,rate:s.playbackRate.value,detune:s.detune.value,audio:s.context.currentTime,wall:performance.now(),frames:coreStates.at(-1).practice.frames};});
   const original=await sample();report.originalMusic=original;
   for(const speed of [.5,2,1]){
    await page.locator('#canvas').focus();await page.keyboard.press('F12');await page.waitForFunction(()=>coreStates.at(-1)?.mode===2);await page.selectOption('[data-practice=speed]',String(speed));await page.waitForFunction(speed=>coreStates.at(-1)?.practice?.options.speed===speed,speed);await page.click('[data-close-practice]');await page.waitForTimeout(500/speed);await tap('Enter',1000/speed);await page.waitForFunction(()=>coreStates.at(-1)?.mode===1);
    const before=await sample();await page.waitForTimeout(1600);const after=await sample(),ratio=(after.audio-before.audio)*1000/(after.wall-before.wall),gameFrames=after.frames-before.frames;
    assert.equal(after.rate,1);assert.equal(after.detune,0);assert.equal(after.sources,original.sources,'changing game speed must not restart BGM');assert(Math.abs(ratio-1)<.12,'BGM must advance in real time at game speed '+speed);report.musicSpeeds.push({speed,before,after,ratio,gameFrames});
   }
   assert(report.musicSpeeds[1].gameFrames>report.musicSpeeds[0].gameFrames*2,'game speed must change while BGM stays at 1x');
  }
  await tap('ArrowRight',550);await tap('ArrowLeft',450);await tap('Shift',250);await tap('z',500);await tap('x');
  // Exercise the same ordinary touch mailbox API, with no guest test mutation.
  await page.evaluate(()=>{const s=coreStates.at(-1);coreWorkers.at(-1).postMessage({type:'input',input:{generation:s.generation,points:9,touch:{active:true,unlimited:false,x:80,y:-32}}});});
  await page.waitForTimeout(150);
  await page.evaluate(()=>{const s=coreStates.at(-1);coreWorkers.at(-1).postMessage({type:'input',input:{generation:s.generation,points:1,touch:null}});});
  await page.click('#pause');await page.waitForFunction(()=>coreStates.at(-1)?.mode===2,null,{timeout:10000});await page.waitForTimeout(250);
  report.pause=await read();await page.locator('#canvas').screenshot({path:path.join(root,'reports',`${reportStem}-pause.png`)});
  await tap('Enter',300);report.resumed=await read();await page.waitForFunction(()=>coreStates.at(-1)?.mode===1,null,{timeout:10000});
  if(fault){
   await page.evaluate(()=>storageWorkers.at(-1).dispatchEvent(new ErrorEvent('error',{message:'injected compressor failure'})));
   await page.waitForFunction(()=>document.querySelector('#record-status').textContent.includes('录像已停止'));
   const before=await read();await tap('ArrowRight',650);const after=await read();
   assert(after.ticks>before.ticks);assert(after.x>before.x);assert.equal(await page.locator('#record-save').isDisabled(),true);
   report.fault={before,after,status:await page.locator('#record-status').innerText()};report.passed=true;
   console.log('PASS browser recorder failure leaves the real player running');return;
  }
  if(process.env.TH05_RECORD_QUIT==='1'){
   await page.click('#pause');await page.waitForFunction(()=>coreStates.at(-1)?.mode===2);await page.waitForTimeout(250);
   await tap('ArrowDown');await tap('Enter');
  }else await page.click('#record-finish');
  await page.waitForFunction(()=>!document.querySelector('#record-save').disabled||document.querySelector('#record-status').textContent.includes('录像已停止'),null,{timeout:30000});
  assert.equal(await page.locator('#record-save').isDisabled(),false,await page.locator('#record-status').innerText());
  const download=page.waitForEvent('download');
  await page.click(await page.locator('#replay-save-dialog').isVisible()?'#replay-prompt-save':'#record-save');
  const file=path.join(root,'reports',`${reportStem}.th05r`);await (await download).saveAs(file);report.fileBytes=fs.statSync(file).size;
  report.ended=await read();const before=await read();
  if(process.env.TH05_RECORD_QUIT!=='1'){
   await tap('ArrowRight',600);const after=await read();assert(after.ticks>before.ticks);assert(after.x>before.x);report.playerContinued={before,after};
  }
  const spectators=await setup(),viewer=await spectators.newPage();viewer.on('pageerror',e=>report.errors.push(e.message));
  await viewer.goto(base+'/solo-replay.html?qa=1');await viewer.setInputFiles('#file',file);await viewer.waitForFunction(()=>!document.querySelector('#play').disabled);
  report.commands=await viewer.evaluate(async fileBytes=>{
   const {decodeReplay}=await import('/external-replay-codec.js');const replay=await decodeReplay(new Blob([new Uint8Array(fileBytes)]));
   const commands=replay.header.events.flatMap(e=>e.commands);
   return {independentMusic:replay.header.independentMusic,events:replay.header.events.length,touch:commands.filter(c=>c.type==='input'&&c.input.touch?.active).length,keys:commands.filter(c=>c.type==='key').length,helpers:commands.filter(c=>c.type==='practice-options').length,clockCount:replay.header.result.clockCount};
  },Array.from(fs.readFileSync(file)));
  assert(report.commands.touch>0);assert(report.commands.keys>0);
  assert(report.commands.helpers>0);
  assert.equal(report.commands.independentMusic,true);
  await viewer.click('#play');await viewer.waitForFunction(()=>th05BrowserReplayQA.read().result||th05BrowserReplayQA.read().state?.externalReplay?.boundary>20||th05BrowserReplayQA.read().status.includes('失败'),null,{timeout:60000});
  report.playback=await viewer.evaluate(()=>th05BrowserReplayQA.read());
  if(report.playback.result){assert.equal(report.playback.result.matches,true,report.playback.status);}
  else{
  await viewer.click('#hold');await viewer.waitForTimeout(150);const held=await viewer.evaluate(()=>th05BrowserReplayQA.read().state.externalReplay.boundary);
  await viewer.waitForTimeout(200);assert.equal(await viewer.evaluate(()=>th05BrowserReplayQA.read().state.externalReplay.boundary),held);
  await viewer.locator('#canvas').focus();await viewer.keyboard.press('ArrowLeft');await viewer.click('#hold');
  await viewer.waitForFunction(()=>th05BrowserReplayQA.read().result||th05BrowserReplayQA.read().status.includes('失败'),null,{timeout:120000});
  }
  report.playback=await viewer.evaluate(()=>th05BrowserReplayQA.read());assert.equal(report.playback.result?.matches,true,report.playback.status);
  await viewer.waitForFunction(()=>musicSources.length>0,null,{timeout:15000});report.playbackMusic=await viewer.evaluate(()=>({sources:musicSources.length,rate:musicSources.at(-1).playbackRate.value,detune:musicSources.at(-1).detune.value}));assert.equal(report.playbackMusic.rate,1);assert.equal(report.playbackMusic.detune,0);
  report.specialRequests=report.requests.filter(name=>/(?:patch-stage-|th05-stage-|stage-runtime|wdosbox-x-stage|frame-replay-(?:core|ending|cn|jp)|\/frame-replay\.json)/.test(name));
  assert.deepEqual(report.specialRequests,[]);assert.deepEqual(report.errors,[]);report.passed=true;
  console.log('PASS browser-only record, touch/pause, player continues, independent import/playback and final guest SHA',language,report.fileBytes);
 }catch(error){report.passed=false;report.failure=error.stack;throw error;}
 finally{report.finalPages=[];for(const context of browser.contexts())for(const page of context.pages())report.finalPages.push(await page.evaluate(()=>({url:location.href,state:globalThis.coreStates?.at(-1),status:document.getElementById('status')?.textContent,recordStatus:document.getElementById('record-status')?.textContent})).catch(()=>null));fs.writeFileSync(path.join(root,'reports',`${reportStem}.json`),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
