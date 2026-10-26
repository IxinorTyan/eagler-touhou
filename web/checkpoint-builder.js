// Independent browser replica. The player's core never captures checkpoints.
import {ConfirmedHistory} from './netplay/confirmed-history.js';
import {CHECKPOINT_INTERVAL} from './netplay/checkpoint-archive.js';
// The controller only queues small confirmed-input slices. All emulation,
// capture and compression runs in its dedicated ordinary spectator Worker.
// Avoid nested Workers: their module fetches are less portable across hosts.
export function createCheckpointBuilder(){
const controller={onmessage:null,postMessage(data){queueMicrotask(()=>receive(data));},terminate(){stopped=true;core?.terminate();for(const p of waiters.values())p.reject(Error('检查点后台已停止'));waiters.clear();}};
const postMessage=data=>controller.onmessage?.({data});
let core=null,history=null,cursor=0,busy=false,ready=false,ending=false,stopped=false,lastStage=0,lastSaved=0;
const waiters=new Map();
function stop(error){if(stopped)return;stopped=true;core?.terminate();for(const p of waiters.values())p.reject(error);waiters.clear();postMessage({type:'error',message:error.message});}
function ask(type,data,reply){return new Promise((resolve,reject)=>{waiters.set(reply,{resolve,reject});core.postMessage({type,...data});});}
async function save(stage){
  const saved=await ask('checkpoint-save',{request:cursor},'checkpoint-saved');
  postMessage({type:'checkpoint',frame:saved.frame,stage:saved.stage,identity:saved.identity,bytes:saved.bytes},[saved.bytes.buffer]);lastSaved=cursor;lastStage=stage;
}
async function pump(){
  if(busy||!ready||stopped)return;busy=true;
  try{
    while(cursor<history.frames&&!stopped){
      const rows=[],limit=Math.min(history.frames,cursor+32,(Math.floor(cursor/CHECKPOINT_INTERVAL)+1)*CHECKPOINT_INTERVAL);
      for(let n=cursor;n<limit;n++)rows.push(history.row(n));
      const result=await ask('history-slice',{frame:cursor,rows},'history-sliced');cursor=result.frame;
      const stage=result.stage;
      if(stage!==lastStage||cursor%CHECKPOINT_INTERVAL===0)await save(stage);
    }
    if(ending&&!stopped){if(cursor>lastSaved)await save(lastStage);stopped=true;core.terminate();postMessage({type:'done',frame:cursor});}
  }catch(error){stop(error);}finally{busy=false;}
}
async function receive(data){if(stopped)return;try{
  if(data.type==='boot'){
    history=new ConfirmedHistory(data.header);core=new Worker(new URL('./lan-worker.js',import.meta.url),{type:'module'});
    core.onerror=e=>stop(Error(e.message||'浏览器检查点模拟器 Worker 加载失败'));
    core.onmessage=({data:r})=>{
      if(r.type==='frame'){r.bitmap.close();core.postMessage({type:'frame-ack',seq:r.seq});return;}
      if(r.type==='music')return;
      if(r.type==='error'){stop(Error(r.message));return;}
      const p=waiters.get(r.type);if(p){waiters.delete(r.type);p.resolve(r);}
    };
    const boot=await ask('boot',{settings:{language:data.header.language,rollback:false},config:data.header.config,viewSlot:0,verifyHistory:true},'ready');
    for(const key of ['checksum','diskSha','coreSha','guestSha'])if(boot[key]!==data.header[key])throw Error('检查点后台开局校验不一致：'+key);
    if(boot.historyHeader.identity!==data.header.identity)throw Error('检查点后台身份不一致');
    await save(boot.state.stage);ready=true;pump();return;
  }
  if(data.type==='append'){history.append(data.first,data.bytes);pump();}
  if(data.type==='end'){ending=true;pump();}
  if(data.type==='stop')controller.terminate();
}catch(error){stop(error);}}
return controller;
}
