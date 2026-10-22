const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),port=Number(process.env.PROBE_PORT||19902),players=Number(process.env.PROBE_PLAYERS||2),language=process.env.PROBE_LANGUAGE||'cn',rollback=process.env.PROBE_ROLLBACK==='1',output=process.env.PROBE_OUTPUT||'stage4-dialog-probe',characters=(process.env.PROBE_CHARACTERS||'0,1,2').split(',').map(Number);
const injected=`
let dialogFast=false,dialogKilled=false,dialogBefore=null,dialogSkip=null;
const dialogPair=()=>Array.from({length:${players}},(_,i)=>(frame%30<15?32:0)|(${process.env.PROBE_BOMBS==='1'}&&(${process.env.PROBE_REPEAT_BOMBS==='1'}?(frame>=1800&&frame<1800+480*${players}*3&&Math.floor((frame-1800)/480)%${players}===i&&(frame-1800)%480<6):(frame>=1800+i*900&&frame<1806+i*900))?16:0));
const dialogOriginalInput=input;
input=function(pair){dialogOriginalInput(pair);if(mailbox>=0){const h=mod.HEAPU8,v=new DataView(h.buffer),d=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;h[mailbox+patch.mailbox_offsets.invincible]=1;
 if(${process.env.PROBE_NATURAL!=='1'}&&!dialogFast&&h[d+0x576e]===3&&v.getUint16(mailbox+26,true)>=2&&v.getUint16(mailbox+36,true)>20&&v.getUint16(mailbox-patch.mailbox_cs_offset+patch.entry_map.hud_scroll_line,true)%400===0){dialogSkip={frame,scroll:v.getUint16(mailbox-patch.mailbox_cs_offset+patch.entry_map.hud_scroll_line,true)};h[d+0x3515]=0;dialogFast=true;}
 if(!dialogKilled&&h[d+0x576e]===3&&h[d+0x5ac9]===2&&v.getUint16(d+0x5aca,true)>120){v.setInt16(d+${process.env.PROBE_KILL==='yuki'?'0x5ade':'0x5ac6'},0,true);dialogKilled=true;}
}};
globalThis.dialogProbe={
 skip(){return dialogSkip;},
 jump(stage){const h=mod.HEAPU8,v=new DataView(h.buffer),d=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
  const resident=guestBase+v.getUint16(d+0x41fe,true)*16+v.getUint16(d+0x41fc,true);
  h[resident+0x13]=stage;h[d+0x576c]=2;},
 async run(count){try{for(let n=0;n<count;n++){if(${process.env.PROBE_WATCH==='1'})dialogBefore=this.dump();advance(dialogPair(),${rollback});confirm(${rollback}?Math.max(confirmed,frame-12):frame);if(${process.env.PROBE_WATCH==='1'}){const a=mod.nativeExports(),h=mod.HEAPU8,p=a.thCoreState(0)+new DataView(h.buffer).getUint16(6558268,true)*16;if(h[p]!==77&&h[p]!==90)return {error:'MCB overwritten',state:state(),diagnostic:this.diagnostic()};}if(n%16===15)await yieldHost();}return {state:state(),boss:mailbox<0?null:this.boss()};}
  catch(e){return {error:e.message,stack:e.stack,state:state(),continuation:(()=>{try{return mod.captureContinuation();}catch(e){return e.message;}})()};}},
 state(){return state();},
 present(){mod.framePresenter.flush({redraw:true});return state();},
 async hudScan(count){const samples=[];
  for(let n=0;n<count;n++){
   const result=await this.run(1);if(result.error)throw Error(result.error);await yieldHost();
   const f=mod.framePresenter.capture(),h=mod.HEAPU8,bg=Array.from(h.slice(f.frame+(100*640+450)*3,f.frame+(100*640+450)*3+3)),icons=[];
   for(let seat=0;seat<${players};seat++)for(const [name,x,y] of [['shot',472,112],['life',512,112],['power',448,128],['bomb',512,128]]){
    let hash=2166136261,count=0;
    for(let dy=0;dy<16;dy++)for(let dx=0;dx<16;dx++){
     const at=f.frame+((y+seat*32+dy)*640+x+dx)*3,ink=+(h[at]!==bg[0]||h[at+1]!==bg[1]||h[at+2]!==bg[2]);hash=Math.imul(hash^ink,16777619)>>>0;count+=ink;
    }icons.push({name,seat,hash,count});
   }samples.push({frame,icons});
  }
  return {from:samples[0].frame,to:frame,icons:samples[0].icons.map((icon,i)=>({...icon,hashes:[...new Set(samples.map(s=>s.icons[i].hash))],minPixels:Math.min(...samples.map(s=>s.icons[i].count))}))};
 },
 async replay(){const end=frame,from=end-8,before=await sha256(mod.HEAPU8),regs=mod.HEAPU8.slice(mod.nativeExports().thCoreState(2),mod.nativeExports().thCoreState(2)+mod.nativeExports().thCoreState(3));await onmessage({data:{type:'restore',frame:from}});if(fatal||frame!==from)throw Error('Restore failed');const result=await this.run(8),after=await sha256(mod.HEAPU8);if(result.error||frame!==end||before!==after||!regs.every((v,i)=>mod.HEAPU8[mod.nativeExports().thCoreState(2)+i]===v))throw Error('Stage-four replay mismatch '+JSON.stringify({from,end,before,after,error:result.error}));return {from,end,heapSha:after};},
 before(){return dialogBefore;},
 logs(){return dialogLogs;},
 diagnostic(){const a=mod.nativeExports(),h=mod.HEAPU8;const str=p=>{let e=p;while(h[e]&&e<p+1000)e++;return new TextDecoder().decode(h.subarray(p,e));};return {exit:[a.qa_exit_0?.value,a.qa_exit_1?.value],format:str(a.qa_exit_0?.value||0),message:str(new DataView(h.buffer).getUint32(a.qa_exit_1?.value||0,true)),args:Array.from(h.slice(a.qa_exit_1?.value||0,(a.qa_exit_1?.value||0)+80)),segments:Array.from(h.slice(a.thCpuState(7),a.thCpuState(7)+a.thCpuState(8)))};},
 configure(){const a=mod.nativeExports();if(${process.env.PROBE_CPU==='0'})mod.HEAPU32[a.thCpuState(0)>>>2]=0;if(${process.env.PROBE_SCHEDULER==='0'})new DataView(mod.HEAPU8.buffer).setFloat64(a.thSchedulerState()+16,1,true);},
 listen(){globalThis.dialogLogs=[];ci.events().onMessage((...args)=>{dialogLogs.push(args);if(dialogLogs.length>40)dialogLogs.shift();});},
 dump(){const a=mod.nativeExports(),h=mod.HEAPU8;return {bases:[guestBase,a.thCoreState(0),mailbox],firstMCB:new DataView(h.buffer).getUint16(6558268,true),guest:Array.from(h.slice(a.thCoreState(0),a.thCoreState(0)+0x100000)),regs:Array.from(h.slice(a.thCoreState(2),a.thCoreState(2)+a.thCoreState(3)))};},
 boss(){const h=mod.HEAPU8,v=new DataView(h.buffer),d=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16,c=mailbox-patch.mailbox_cs_offset;return {hp:v.getInt16(d+0x5ac6,true),phase:h[d+0x5ac9],phaseFrame:v.getUint16(d+0x5aca,true),otherHp:v.getInt16(d+0x5ade,true),otherPhase:h[d+0x5ae1],bomb:{active:h[d+0x4206],used:Array.from({length:${players}},(_,i)=>v.getUint16(c+patch.entry_map.personal_stats+i*32+26,true))},background:Array.from(h.slice(d+0x306c,d+0x307c))};},
};`;
let server,browser;const report={language,players,rollback,trace:[]};
(async()=>{try{
 const normalProbe=!process.env.PROBE_HEAP&&process.env.PROBE_INSTRUMENT!=='1',probeName='stage4-active-probe-'+port+'.js';
 if(normalProbe)fs.writeFileSync(path.join(root,'build',probeName),injected);
 server=spawn('python',['-u',normalProbe?'tools/qa_lan_server.py':'lan_server.py','--bind','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,...normalProbe?{TH05_QA_STAGE4:probeName}:{}},windowsHide:true,stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>process.stderr.write(b));
 await new Promise((r,j)=>{server.once('error',j);server.once('exit',c=>j(Error('server '+c)));server.stdout.once('data',r);setTimeout(()=>j(Error('server timeout')),10000).unref();});
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>console.error('PAGE',e.stack));page.on('console',m=>console.log('CONSOLE',m.text()));
 if(process.env.PROBE_INSTRUMENT==='1')await page.route('**/stage4-qa.wasm',r=>r.fulfill({contentType:'application/wasm',body:fs.readFileSync(path.join(root,'build/stage4-qa.wasm'))}));
 if(!normalProbe)await page.route('**/lan-worker.js',async r=>{const res=await r.fetch();let body=await res.text();if(process.env.PROBE_INSTRUMENT==='1')body=body.replace(/    loadCompiledCore[^\n]+/,'    WebAssembly.compile(await(await fetch("stage4-qa.wasm")).arrayBuffer()),');if(process.env.PROBE_HEAP)body=body.replace('  let batch=',`  {const f=files.find(f=>f.path.toUpperCase().endsWith('/MAIN.EXE')),h=f.contents;let n=0;for(let i=0;i<h.length-5;i++)if(h[i]===0x9c&&h[i+1]===0x50&&h[i+2]===0xb8&&h[i+3]===0x18&&h[i+4]===0x47){new DataView(h.buffer,h.byteOffset,h.byteLength).setUint16(i+3,${Number(process.env.PROBE_HEAP)/16},true);n++;}if(n!==1)throw Error('Heap probe signature '+n);}\n  let batch=`);await r.fulfill({response:res,body:body+injected});});
 await page.goto('http://127.0.0.1:'+port+'/local.html');
 await page.evaluate(({language,players,rollback,characters})=>{const canvas=document.createElement('canvas');canvas.id='probe-canvas';canvas.width=640;canvas.height=400;document.body.replaceChildren(canvas);const ctx=canvas.getContext('2d');globalThis.proof={worker:new Worker('lan-worker.js',{type:'module'}),ready:null,error:null,displayed:0};proof.worker.onmessage=({data})=>{
  if(data.type==='frame'){ctx.drawImage(data.bitmap,0,0,640,400);proof.displayed++;data.bitmap.close();proof.worker.postMessage({type:'frame-ack',seq:data.seq});}
  else if(data.type==='ready')proof.ready=data;
  else if(data.type==='error')proof.error=data;
 };proof.worker.onerror=e=>proof.error={message:e.message};proof.worker.postMessage({type:'boot',settings:{language,rollback,players},config:{rank:1,players:Array.from({length:players},(_,i)=>({character:characters[i],spares:5,bombs:3}))},viewSlot:0});},{language,players,rollback,characters});
 await page.waitForFunction(()=>proof.ready||proof.error,null,{timeout:120000});const boot=await page.evaluate(()=>({ready:proof.ready,error:proof.error}));if(boot.error)throw Error(JSON.stringify(boot.error));report.boot=boot.ready;
 const worker=page.workers()[0];
 const screenshots=new Set();
 async function screenshot(label){if(screenshots.has(label))return;screenshots.add(label);const before=await page.evaluate(()=>proof.displayed);await worker.evaluate(()=>dialogProbe.present());await page.waitForFunction(n=>proof.displayed>n,before);const file=output+'-'+label+'.png';await page.locator('#probe-canvas').screenshot({path:path.join(root,'reports',file)});report.screenshots??=[];report.screenshots.push(file);}
 await worker.evaluate(()=>dialogProbe.listen());
 await worker.evaluate(()=>dialogProbe.configure());
 await worker.evaluate(()=>dialogProbe.jump(3));
 for(let batch=0;batch<Number(process.env.PROBE_BATCHES||240);batch++){
  const result=await worker.evaluate(()=>dialogProbe.run(100));
  report.trace.push({frame:result.state?.frame,ticks:result.state?.ticks,stageFrame:result.state?.stageFrame,stage:result.state?.stage,generation:result.state?.generation,boss:result.boss});
  console.log('PROGRESS',JSON.stringify(report.trace.at(-1)));if(result.error){report.failure=result;report.logs=await worker.evaluate(()=>dialogProbe.logs());console.error('TRAP',result.error,result.stack,JSON.stringify(report.logs));
   report.diagnostic=await worker.evaluate(()=>dialogProbe.diagnostic());console.log('DIAGNOSTIC',JSON.stringify(report.diagnostic));const dump=await worker.evaluate(()=>dialogProbe.dump());
   fs.writeFileSync(path.join(root,'build/stage4-failure-guest.bin'),Buffer.from(dump.guest));report.registers=dump.regs;report.memory={bases:dump.bases,firstMCB:dump.firstMCB};if(process.env.PROBE_WATCH==='1'){const before=await worker.evaluate(()=>dialogProbe.before());fs.writeFileSync(path.join(root,'build/stage4-before-guest.bin'),Buffer.from(before.guest));report.before={regs:before.regs,bases:before.bases,firstMCB:before.firstMCB};}break;}
  if(process.env.PROBE_DUMP==='1'&&result.state?.frame===700){const dump=await worker.evaluate(()=>dialogProbe.dump());fs.writeFileSync(path.join(root,'build/'+output+'-opening.bin'),Buffer.from(dump.guest));report.opening={bases:dump.bases,firstMCB:dump.firstMCB,regs:dump.regs,diagnostic:await worker.evaluate(()=>dialogProbe.diagnostic())};}
  if(process.env.PROBE_SCREENSHOTS==='1'){
   if(process.env.PROBE_TRANSLATION_LAYOUT==='1'&&(result.boss?.phase===255||result.state?.frame<=1000||report.trace.length>1&&result.state?.ticks===report.trace.at(-2).ticks))await screenshot('layout-'+result.state.frame);
   if(result.state?.frame===700)await screenshot('opening');
   if(result.boss?.phase===255)await screenshot('survivor-dialog');
  }
  if(process.env.PROBE_REPLAY==='1'&&[1800,2700,3600].includes(result.state?.frame)){await worker.evaluate(()=>dialogProbe.run(4));report.replays??=[];report.replays.push(await worker.evaluate(()=>dialogProbe.replay()));console.log('REPLAY',JSON.stringify(report.replays.at(-1)));await worker.evaluate(()=>dialogProbe.run(96));}
  if(result.state?.frame>Number(process.env.PROBE_FRAMES||5000))break;
  if(batch%10===0)fs.writeFileSync(path.join(root,'reports/'+output+'.json'),JSON.stringify(report,null,2));
 }
 report.logs=await worker.evaluate(()=>dialogProbe.logs());
 report.stageSkip=await worker.evaluate(()=>dialogProbe.skip());
 if(process.env.PROBE_NATURAL!=='1')assert(report.stageSkip&&report.stageSkip.scroll%400===0,'boss skip requires native hardware scroll origin zero');
 if(process.env.PROBE_VALIDATE==='1'){
  assert(!report.failure,JSON.stringify(report.failure));const t=report.trace,last=t.at(-1);
  assert(last.stage===3&&last.frame>Number(process.env.PROBE_FRAMES||5000),'complete stage-four target');
  assert(last.ticks>t.at(-3).ticks,'native gameplay keeps advancing');
  assert(t.some(x=>x.boss?.phase===255),'survivor dialogue was reached');
  assert(last.boss.phase>=2&&last.boss.phase<10,'battle resumes after dialogue');
  report.hud=await worker.evaluate(()=>dialogProbe.hudScan(120));
  for(const icon of report.hud.icons){assert(icon.minPixels>0,'visible '+icon.name);assert.equal(icon.hashes.length,1,'stable '+icon.name+' P'+(icon.seat+1));}
  report.final=await worker.evaluate(()=>dialogProbe.state());assert(!await page.evaluate(()=>proof.error),'no worker error');
  report.passed=true;console.log('PASS stage-four dialogs, continued combat and 120 consecutive HUD frames');
 }
 if(process.env.PROBE_SCREENSHOTS==='1')await screenshot('combat');
}finally{fs.writeFileSync(path.join(root,'reports/'+output+'.json'),JSON.stringify(report,null,2));await browser?.close();if(server){server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));}}})().catch(e=>{console.error(e);process.exitCode=1;});
