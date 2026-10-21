// Real ordinary cores, independent builder, portable file and late HTTP viewer.
// Browser routes call the actual Python handlers over stdio; no TCP listener.
const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),readline=require('node:readline');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),origin='http://127.0.0.1:9877';
const stageFixture=process.env.TH05_CHECKPOINT_STAGE==='1',length=stageFixture?6720:3720;
// Test-route-only intervention: both ordinary source and replica invoke the
// existing native stage loader at the same confirmed input boundary. No guest
// instruction, core binary or production script is changed. This is not a
// natural playthrough. The restored viewer must inherit the resulting machine.
const stageHook=`\nconst auditOriginalAdvance=advance;
advance=(...args)=>{
 if(frame===6000){
  const h=mod.HEAPU8,v=new DataView(h.buffer),d=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
  const resident=guestBase+v.getUint16(d+0x41fe,true)*16+v.getUint16(d+0x41fc,true);
  h[resident+0x13]=1;h[d+0x576c]=2;
 }
 return auditOriginalAdvance(...args);
};\n`;
let harness=fs.readFileSync(path.join(__dirname,'test_multiplayer_history.cjs'),'utf8').match(/const harness=`([\s\S]*?)`;/)[1]
 .replace('const file=await host.seal(',"host.end('checkpoint fixture');const file=await host.seal(")
 .replace('return {frame,recorded:host?.history.frames,failure};','return {frame,recorded:host?.history.frames,failure,points:host?.history.checkpoints.index(),done:host?.history.checkpointsDone,checkpointError:host?.history.checkpoints.failed,url:host?.networkURL};')
 .replace('async seal(){','connect(auth){host.connectNetwork(auth);}, async seal(){');
if(stageFixture)harness=harness.replace('let offlineMask=frame>=280?2:0;','let offlineMask=0;')
 .replace('const direction=(Math.floor(frame/40)+slot)%2?4:8;','const direction=frame%240<120?8:4;')
 .replace('32|direction;','32|64;');
const bridge=spawn('python',['tools/test_history_service.py','--bridge'],{cwd:root,stdio:['pipe','pipe','pipe']});
let serial=0;const pending=new Map(),report={stageFixture,length,scope:stageFixture?'QA-triggered native stage load after 6000 confirmed frames; not a natural clear':'ordinary confirmed input',errors:[]};let lostCheckpointAck=false,retriedCheckpoint=false,failedCheckpointRead=false;
bridge.stderr.on('data',data=>process.stderr.write(data));
readline.createInterface({input:bridge.stdout}).on('line',line=>{const value=JSON.parse(line);pending.get(value.id)?.(value);pending.delete(value.id);});
function request(method,url,data){return new Promise(resolve=>{const id=++serial;pending.set(id,resolve);bridge.stdin.write(JSON.stringify({id,method,url,data})+'\n');});}
async function routes(context){await context.route(origin+'/**',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.pathname==='/capture.html')return route.fulfill({body:harness,contentType:'text/html'});
 if(url.pathname.startsWith('/api/')){
  const data=req.method()==='POST'?req.postDataJSON():null,reply=await request(req.method(),url.pathname+url.search,data);
  if(url.pathname==='/api/history-checkpoint'&&data?.payload&&data.offset===0){
   if(!lostCheckpointAck&&reply.status===200){lostCheckpointAck=true;return route.abort();}
   if(lostCheckpointAck)retriedCheckpoint=true;
  }
  if(url.pathname==='/api/history-checkpoint'&&req.method()==='GET'&&!failedCheckpointRead){failedCheckpointRead=true;return route.fulfill({status:503,json:{error:'checkpoint read retry fixture'}});}
  return route.fulfill({status:reply.status,json:reply.body});
 }
 const file=path.resolve(web,'.'+url.pathname);if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
 if(stageFixture&&url.pathname==='/lan-worker.js')return route.fulfill({body:fs.readFileSync(file,'utf8')+stageHook,contentType:'text/javascript'});
 return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});
});}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const players=await browser.newContext(),fresh=await browser.newContext();await routes(players);await routes(fresh);
  players.on('requestfailed',r=>console.log('request failed',r.url(),r.failure()?.errorText));
  const source=await players.newPage();source.on('console',m=>{if(m.type()==='error')console.log('browser error',m.text());});source.on('pageerror',e=>report.errors.push(e.message));await source.goto(origin+'/capture.html');await source.waitForFunction(()=>window.capture);
  report.boot=await source.evaluate(()=>capture.boot('cn',2,false));
  const protocol='th05-netplay/9',post=async(action,data)=>{const r=await request('POST','/api/'+action,{protocol,...data});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const owner=await post('create',{}),guest=await post('join',{room:owner.room});
  const auth={room:owner.room,token:owner.token,generation:owner.state.generation};
  await post('settings',{...auth,...owner.state.settings,spares:3});
  await post('ready',{...auth,ready:true});await post('ready',{...auth,token:guest.token,ready:true});await post('start',auth);
  await source.evaluate(auth=>capture.connect(auth),auth);await source.waitForFunction(()=>capture.read().url,null,{timeout:30000});
  const link=await source.evaluate(()=>capture.read().url),watch=new URL(link).hash.slice(7);
  for(let at=0;at<length;at+=120){await source.evaluate(()=>capture.batch(120,false));if(at%600===0)console.log('captured',at+120);}
  const bytes=await source.evaluate(()=>capture.seal());report.archive=await source.evaluate(()=>capture.read());
  assert.equal(report.archive.checkpointError,null);assert.equal(report.archive.done,true);
  assert(report.archive.points.some(e=>e.frame===1800));assert(report.archive.points.some(e=>e.frame===3600));
  const file=path.join(root,'reports',stageFixture?'checkpoint-stage-history.th05m':'checkpoint-history.th05m');fs.writeFileSync(file,Buffer.from(bytes));assert.equal(Buffer.from(bytes).subarray(0,8).toString(),'T05MP003');
  const viewer=await fresh.newPage();viewer.on('pageerror',e=>report.errors.push(e.message));await viewer.goto(origin+'/coop-replay.html?qa=1');await viewer.setInputFiles('#file',file);
  const read=()=>viewer.evaluate(()=>th05CoopReplayQA.read());
  report.seeks=[];
  for(const [frame,point]of [[1900,1800],[100,null],[3650,3600]]){
   await viewer.fill('#seek-frame',String(frame));await viewer.click('#seek');await viewer.click('#pause');
   // Pause during boot is tested separately; seek again after boot has settled.
   await viewer.waitForFunction(()=>th05CoopReplayQA.read().ready||th05CoopReplayQA.read().error,null,{timeout:60000});
   await viewer.fill('#seek-frame',String(frame));await viewer.click('#seek');
   await viewer.waitForFunction(n=>{const s=th05CoopReplayQA.read();return s.error||s.cursor===n&&s.target===null&&!s.pending;},frame,{timeout:90000});
   const state=await read();assert.equal(state.error,null);assert.equal(state.checkpointUsed,point);assert.equal(state.paused,true);
   if(point)assert(state.sliceStats.steps<=frame-point,'must skip the entire checkpoint prefix');
   report.seeks.push(state);console.log('portable seek',frame,'from',state.checkpointUsed);
  }
  await viewer.click('#sound');await viewer.waitForFunction(()=>!!th05CoopReplayQA.read().music?.id,null,{timeout:30000});
  report.soundBefore=await read();assert.equal(report.soundBefore.sound.state,'suspended');
  if(stageFixture){
   const stagePoint=report.archive.points.find(e=>e.stage===1&&e.frame>6000);
   assert(stagePoint&&stagePoint.frame+360<length,'native stage must load and leave a verified tail');
   assert(await viewer.locator('#stage-select').isVisible());
   await viewer.selectOption('#stage-select',String(stagePoint.frame));
   await viewer.waitForFunction(n=>{const s=th05CoopReplayQA.read();return s.error||s.cursor===n&&s.target===null&&!s.pending;},stagePoint.frame,{timeout:60000});
   report.stageStart=await read();assert.equal(report.stageStart.error,null);assert.equal(report.stageStart.checkpointUsed,stagePoint.frame);assert(report.stageStart.paused);
   await viewer.fill('#seek-frame',String(stagePoint.frame+360));await viewer.click('#seek');
   await viewer.waitForFunction(n=>{const s=th05CoopReplayQA.read();return s.error||s.cursor===n&&s.target===null&&!s.pending;},stagePoint.frame+360,{timeout:60000});
   report.stageTail=await read();assert.equal(report.stageTail.error,null);assert(report.stageTail.lastProof.ticks>report.stageStart.lastProof.ticks+120,'restored stage must advance actual native gameplay');
   assert.equal(report.stageTail.sliceStats.steps,360);console.log('native stage checkpoint and verified tail',stagePoint.frame,report.stageTail.cursor);
  }
  // Restoring an exact final checkpoint must complete even for a paused seek;
  // it cannot rely on pump(), which deliberately does nothing while paused.
  await viewer.fill('#seek-frame',String(length));await viewer.click('#seek');
  await viewer.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.completed;},null,{timeout:60000});
  report.finalCheckpoint=await read();assert.equal(report.finalCheckpoint.error,null);assert.equal(report.finalCheckpoint.cursor,length);assert.equal(report.finalCheckpoint.checkpointUsed,length);assert.equal(report.finalCheckpoint.sliceStats.steps,0);assert.equal(report.finalCheckpoint.paused,true);
  assert.equal(await viewer.isVisible('#completed'),true);await viewer.click('#end-close');
  // A backward restore must preserve enabled music and leave audio suspended.
  await viewer.fill('#seek-frame','3650');await viewer.click('#seek');
  await viewer.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.cursor===3650&&s.target===null&&!s.pending;},null,{timeout:60000});
  await viewer.waitForFunction(()=>!!th05CoopReplayQA.read().music?.id,null,{timeout:30000});
  report.soundRestored=await read();assert.equal(report.soundRestored.error,null);assert.equal(report.soundRestored.sound.state,'suspended');assert.equal(report.soundRestored.checkpointUsed,3600);
  // Cancel before a fresh checkpoint instance has booted: stale restores must
  // not jump the viewer after cancellation.
  await viewer.fill('#seek-frame','1900');await viewer.click('#seek');await viewer.click('#cancel-seek');
  await viewer.waitForFunction(()=>th05CoopReplayQA.read().ready||th05CoopReplayQA.read().error,null,{timeout:60000});report.cancelled=await read();
  assert.equal(report.cancelled.error,null);assert.equal(report.cancelled.cursor,0);assert.equal(report.cancelled.paused,true);
  const broken=await fresh.newPage();
  await broken.addInitScript(()=>{const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(data,...args){if(data?.type==='checkpoint-load')data={...data,bytes:new Uint8Array([0])};return post.call(this,data,...args);};});
  await broken.goto(origin+'/coop-replay.html?qa=1');await broken.setInputFiles('#file',file);
  await broken.fill('#seek-frame','1900');await broken.click('#seek');
  await broken.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.cursor>=1900&&s.target===null;},null,{timeout:90000});
  report.fallback=await broken.evaluate(()=>th05CoopReplayQA.read());assert.equal(report.fallback.error,null);assert.equal(report.fallback.checkpointUsed,null);assert(report.fallback.sliceStats.steps>=1900);await broken.close();
  const local=await players.newPage();await local.goto(origin+'/coop-replay.html?qa=1&live='+report.boot.id);
  const latePoint=report.archive.points.filter(e=>e.frame<=length-90).at(-1).frame;
  await local.waitForFunction(n=>{const s=th05CoopReplayQA.read();return s.error||s.checkpointUsed===n&&s.target===null;},latePoint,{timeout:90000});
  report.local=await local.evaluate(()=>th05CoopReplayQA.read());assert.equal(report.local.error,null);await local.close();
  for(let n=0;n<600;n++){
   const r=await request('GET','/api/history?watch='+watch+'&from=0');
   if(r.body.checkpointsDone){report.networkIndex=r.body.checkpoints;break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(report.networkIndex?.some(e=>e.frame===latePoint),'portable points must be available before a new viewer joins');
  const remoteContext=await browser.newContext();await routes(remoteContext);const remote=await remoteContext.newPage();
  await remote.goto(origin+'/coop-replay.html?qa=1#watch='+watch);
  await remote.waitForFunction(()=>{const s=th05CoopReplayQA.read();return s.error||s.completed;},null,{timeout:120000});
  report.remote=await remote.evaluate(()=>th05CoopReplayQA.read());assert.equal(report.remote.error,null);assert.equal(report.remote.cursor,length);assert.equal(report.remote.checkpointUsed,latePoint);
  assert(report.remote.sliceStats.steps<=length-latePoint);assert(lostCheckpointAck&&retriedCheckpoint&&failedCheckpointRead);
  const tail=await source.evaluate(()=>capture.batch(0,false).then(r=>r.tail));
  for(const key of ['ticks','gameHash','nativeHash'])assert.equal(report.remote.lastProof[key],tail[key]);
  assert.deepEqual(report.errors,[]);report.passed=true;console.log('PASS portable file seek, cancellation, late local and independent HTTP joins, lost chunk ACK and download retry');
 }finally{fs.writeFileSync(path.join(root,'reports',stageFixture?'checkpoint-stage-history.json':'checkpoint-history.json'),JSON.stringify(report,null,2));await browser.close();bridge.stdin.end();}
})().catch(error=>{console.error(error);bridge.kill();process.exitCode=1;});
