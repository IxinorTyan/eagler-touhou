import assert from 'node:assert/strict';
import {createExternalReplayHost} from '../web/external-replay-host.js';
// Exercise browser scheduling and failure isolation without running guest code.
const NativeSuspending=WebAssembly.Suspending;
WebAssembly.Suspending=function(fn){return fn;};
try{
 const inputs=[],chunks=[],errors=[];let ended=null,resolveInspect;
 const inspected=new Promise(resolve=>resolveInspect=resolve);
 const host=createExternalReplayHost({mode:'record',onChunk:c=>chunks.push(c),onEnd:r=>ended=r,onError:e=>errors.push(e),
  applyInput:c=>inputs.push(c),inspect:()=>inspected});
 const imports={env:{initMessageSyncSleep(){},__asyncjs__syncSleep(){}}},mod={};
 host.attach(mod,imports);imports.env.initMessageSyncSleep();
 host.queue({type:'key',code:90,down:true});host.finish();
 await imports.env.__asyncjs__syncSleep(0,1);
 assert.equal(ended,null,'slow optional hashing does not hold the player continuation');
 assert.equal(host.status.finished,true);assert.equal(host.status.stopped,false);assert.equal(inputs.length,1);
 host.queue({type:'key',code:90,down:false});await imports.env.__asyncjs__syncSleep(0,1);
 assert.equal(inputs.length,2,'input still works after recording ended');
 resolveInspect({guestHash:'12345678'});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(ended.guestHash,'12345678');assert(chunks.some(c=>c.clocks));assert(chunks.some(c=>c.events));assert.deepEqual(errors,[]);
 let fault=null;const live=[];
 const failed=createExternalReplayHost({mode:'record',maxClockBytes:9,onChunk(){},onEnd(){throw Error('invalid export');},
  onError:e=>errors.push(e),onRecordingError:e=>fault=e,applyInput:c=>live.push(c)});
 const other={env:{initTimeoutSyncSleep(){},__asyncjs__syncSleep(){}}};failed.attach({},other);other.env.initTimeoutSyncSleep();
 failed.queue({type:'key',code:262,down:true});await other.env.__asyncjs__syncSleep(0,1);
 assert.match(fault.message,/容量/);assert.equal(failed.status.recording,false);assert.equal(failed.status.stopped,false);assert.equal(live.length,1);
 failed.queue({type:'key',code:262,down:false});await other.env.__asyncjs__syncSleep(0,1);assert.equal(live.length,2);assert.deepEqual(errors,[]);
 const terminalInputs=[],terminalChunks=[];let terminalEnd=null;
 const terminal=createExternalReplayHost({mode:'record',observe:()=> 'clear',onChunk:c=>terminalChunks.push(c),onEnd:r=>terminalEnd=r,
  applyInput:c=>terminalInputs.push(c)});
 const terminalImports={env:{initTimeoutSyncSleep(){},__asyncjs__syncSleep(){}}};terminal.attach({},terminalImports);terminalImports.env.initTimeoutSyncSleep();
 const continued={type:'key',code:90,down:true};terminal.queue(continued);await terminalImports.env.__asyncjs__syncSleep(0,1);
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(terminalInputs,[continued],'terminal input still reaches the live guest at its original boundary');
 assert.equal(terminalChunks.flatMap(chunk=>chunk.events||[]).length,0,'continue confirmation is excluded from the terminal replay');
 assert.equal(terminalEnd?.endReason,'clear','terminal reason reaches the saved replay metadata');
 console.log('PASS optional hashing never holds player continuation; terminal input stays live and outside the replay');
}finally{if(NativeSuspending)WebAssembly.Suspending=NativeSuspending;else delete WebAssembly.Suspending;}
