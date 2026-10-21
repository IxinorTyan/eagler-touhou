const {chromium}=require('C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),base='http://127.0.0.1:9877';
const language=process.env.TH05_LANGUAGE||'cn',prefix=Number(process.env.TH05_PREFIX||720);
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),report={language,prefix,errors:[]};
 try{
  const context=await browser.newContext();
  await context.route(base+'/**',route=>{
   const name=new URL(route.request().url()).pathname;
   if(name==='/checkpoint-test.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><p>checkpoint test</p>'});
   const file=path.resolve(web,'.'+name);if(!file.startsWith(web+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({path:file,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});
  });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/checkpoint-test.html');
  report.result=await page.evaluate(async({language,prefix})=>{
   function core(){
    const w=new Worker('/lan-worker.js',{type:'module'}),waiters=new Map();let fatal=null;
    w.onmessage=({data})=>{
     if(data.type==='frame'){data.bitmap.close();w.postMessage({type:'frame-ack',seq:data.seq});return;}
     if(data.type==='error'){fatal=data.message;for(const p of waiters.values())p.reject(Error(fatal));waiters.clear();return;}
     const p=waiters.get(data.type);if(p){waiters.delete(data.type);p.resolve(data);}
    };
    return {w,send(type,data,reply){if(fatal)return Promise.reject(Error(fatal));return new Promise((resolve,reject)=>{waiters.set(reply,{resolve,reject});w.postMessage({type,...data});});}};
   }
   const config={rank:1,players:[{character:0,spares:3,bombs:3},{character:1,spares:3,bombs:3}]},a=core(),b=core();
   const args={settings:{language,rollback:false},config,verifyHistory:true};
   const first=await a.send('boot',args,'ready');await b.send('boot',args,'ready');
   const pair=n=>[(n%240<120?8:4)|32,32|64],step=async(c,n)=>{
    const r=await c.send('step',{frame:n,pair:pair(n),predicted:false,offlineMask:0},'stepped');
    await c.send('confirm',{prefix:n+1,notify:true},'history-confirmed');return r;
   };
   const baseline=await a.send('checkpoint-save',{request:0},'checkpoint-saved');
   for(let n=0;n<prefix;n++)await step(a,n);
   const saved=await a.send('checkpoint-save',{request:1},'checkpoint-saved');
   const {decodeCheckpoint}=await import('/portable-checkpoint.js');
   let missingBaseRejected=false;try{await decodeCheckpoint(saved.bytes);}catch{missingBaseRejected=true;}
   if(!missingBaseRejected)throw Error('delta must require baseline');
   const restored=await b.send('checkpoint-load',{bytes:saved.bytes,baseBytes:baseline.bytes,request:2},'checkpoint-loaded');
   if(JSON.stringify(restored.proof)!==JSON.stringify(saved.proof))throw Error('restored proof mismatch');
   let last=null;
   for(let n=prefix;n<prefix+360;n++){
    const x=await step(a,n),y=await step(b,n);
    for(const key of ['ticks','gameHash','nativeHash'])if(x.proof[key]!==y.proof[key])throw Error('cross instance divergence at '+(n+1)+' '+key+' '+x.proof[key]+' '+y.proof[key]);
    last=y.proof;
   }
   a.w.terminate();b.w.terminate();
   return {identity:first.historyHeader.identity,baseBytes:baseline.bytes.length,compressedBytes:saved.bytes.length,missingBaseRejected,frame:saved.frame,restored:restored.proof,last,verifiedTail:360};
  },{language,prefix});
  assert.deepEqual(report.errors,[]);report.passed=true;console.log('PASS cross-instance portable checkpoint',JSON.stringify(report.result));
 }finally{fs.writeFileSync(path.join(root,'reports',`portable-checkpoint-${language}-${prefix}.json`),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
