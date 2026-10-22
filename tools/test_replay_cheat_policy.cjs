const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const web=path.resolve(__dirname,'../web'),browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
 const context=await browser.newContext(),page=await context.newPage();
 await context.route('http://127.0.0.1:9877/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/policy-test.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><p>policy test</p>'});
  const file=path.resolve(web,'.'+pathname);if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({path:file,contentType:file.endsWith('.js')?'text/javascript':'application/octet-stream'});
 });
 await page.goto('http://127.0.0.1:9877/policy-test.html');
 const result=await page.evaluate(async()=>{
  const {createHistoryHost}=await import('/netplay/history-host.js'),{ConfirmedHistory,packHistoryRows}=await import('/netplay/confirmed-history.js');
  const {CHEAT_USED,packTouch}=await import('/touch-input.js');
  const header={version:'th05-confirmed-input/1',protocol:'th05-netplay/9',language:'cn',players:2,config:{rank:1,players:[{character:0,spares:3,bombs:3},{character:1,spares:3,bombs:3}]},identity:'a'.repeat(64),coreSha:'b'.repeat(64),diskSha:'c'.repeat(64),guestSha:'d'.repeat(64),checksum:'12345678'};
  const row=pair=>({pair,offlineMask:0,ticks:1,gameHash:1234,nativeHash:0}),bytes=pair=>packHistoryRows([row(pair)],2);
  const assert=(v,message)=>{if(!v)throw Error(message);};
  const host=createHistoryHost(header),viewer=new BroadcastChannel('th05-history-'+host.id),source=new ConfirmedHistory(header);let received=0;
  const viewerId='11111111-1111-4111-8111-111111111111';
  viewer.onmessage=({data})=>{if(data.type==='batch'){source.append(data.first,data.bytes);received++;viewer.postMessage({type:'ack',viewer:viewerId,frames:source.frames});}};
  viewer.postMessage({type:'subscribe',viewer:viewerId});
  host.append(0,bytes([packTouch(32,{active:true,x:400,y:-200}),32]));
  host.append(1,bytes([32,CHEAT_USED]));
  host.append(2,bytes([32,0]));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert(received===3&&source.frames===3&&source.tainted&&host.tainted,'spectators keep receiving history and retain the cheating label after the switch is off');
  const fresh=createHistoryHost(header);fresh.append(0,bytes([32,32]));assert(!fresh.tainted,'a new match starts with a clean spectator state');
  host.dispose();fresh.dispose();viewer.close();return {received,frames:source.frames,tainted:source.tainted};
 });
 assert.equal(result.frames,3);console.log('PASS multiplayer remote-seat sticky taint and continuous spectator history',result);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
