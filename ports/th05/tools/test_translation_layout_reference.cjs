const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),port=19926,report=[];
const targetStage=Number(process.env.PROBE_STAGE||0);
assert(Number.isInteger(targetStage)&&targetStage>=0&&targetStage<=6);
let server,browser;
(async()=>{try{
 server=spawn('python',['-u','lan_server.py','--bind','127.0.0.1','--port',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 await new Promise((r,j)=>{server.once('error',j);server.stdout.once('data',r);});
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 for(const language of ['jp','cn']){
  const context=await browser.newContext({viewport:{width:1000,height:850}}),page=await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/solo-original.html?qa=1`);
  await page.selectOption('#language',language);
  const ready=page.waitForEvent('worker',{predicate:w=>w.url().includes('dosbox-worker')});
  await page.click('#start');const worker=await ready;
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('运行中'),null,{timeout:60000});
  const tap=async()=>{await worker.evaluate(()=>ci.sendKeyEvent(90,true));await page.waitForTimeout(250);await worker.evaluate(()=>ci.sendKeyEvent(90,false));await page.waitForTimeout(500);};
  for(let i=0;i<45;i++){
   if(await worker.evaluate(()=>soloInput?.snapshot?.mode===1))break;
   await tap();
   if(process.argv.includes('--opening'))await page.locator('#canvas').screenshot({path:path.join(root,`reports/layout-intro-${language}-${i}.png`)});
  }
  assert(await worker.evaluate(()=>soloInput?.snapshot?.mode===1),'native MAIN entered');
  const jump=process.argv.includes('--opening')?null:await worker.evaluate(stage=>{
   const h=mod.HEAPU8,v=new DataView(h.buffer),s=soloInput.snapshot;
   const d=s.at-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
   const g=s.at-patch.mailbox_cs_offset-(v.getUint16(s.at+20,true)-patch.data_segment+patch.code_segment)*16;
   const resident=g+v.getUint16(d+0x41fe,true)*16+v.getUint16(d+0x41fc,true);
   if(stage!==s.stage){h[resident+0x13]=stage;h[d+0x576c]=2;}
   return {resident,d,g,stage};
  },targetStage);
  let dialogue=null,lastTicks=-1,still=0;
  if(jump){
   // Let native stage timing and scrolling reach the boss. The previous
   // forced scroll stop moved the graphics boxes away from fixed TRAM text.
   await worker.evaluate(()=>ci.sendKeyEvent(90,true)); // Keep shooting in the private QA run.
   for(let i=0;i<Number(process.env.PROBE_POLLS||6000);i++){
    const sample=await worker.evaluate(({stage})=>{
     const h=mod.HEAPU8,v=new DataView(h.buffer);
     const s=soloInput.snapshot;
     if(s?.mode===1)globalThis.layoutReferenceData=s.at-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
     const d=globalThis.layoutReferenceData;
     if(d===undefined)return null;
     if(h[d+0x576e]!==stage)return null;
     h[d+0x36ee]=192; // Private QA invulnerability timer only.
     const at=d-(patch.data_segment-patch.code_segment)*16+patch.mailbox_cs_offset;
     return {ticks:v.getUint32(at+16,true),stage:h[d+0x576e],scroll:v.getUint16(d+0x3516,true),frames};
    },jump);
    if(sample){
     still=sample.ticks===lastTicks?still+1:0;lastTicks=sample.ticks;
     if(still>=15&&sample.ticks>500){dialogue=sample;break;}
    }
    if(i%200===0)console.log('WAIT native stage',language,sample||await worker.evaluate(()=>state()));
    await page.waitForTimeout(100);
   }
   assert(dialogue,'native dialogue reached without forcing the scroll switch');
   await worker.evaluate(()=>ci.sendKeyEvent(90,false));
  }else await page.waitForTimeout(1800);
  for(let i=0;i<8;i++){
   await page.locator('#canvas').screenshot({path:path.join(root,`reports/layout-native-${language}${jump?'':'-opening'}-${i}.png`)});
   await tap();await page.waitForTimeout(700);
  }
  report.push({language,jump,dialogue,forcedScrollStop:false,visualReviewRequired:true,state:await worker.evaluate(()=>state())});
  fs.writeFileSync(path.join(root,'reports/layout-native-reference.json'),JSON.stringify(report,null,2));
  console.log('CAPTURE native solo reference',language);
  await context.close();
 }
}finally{fs.writeFileSync(path.join(root,'reports/layout-native-reference.json'),JSON.stringify(report,null,2));await browser?.close();server?.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
