// Derive optional observation cores. The original release files stay intact.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import b from '../../th04-coop-lab/build/binaryen-132/package/index.js';
const root='web/vendor/dosbox-net/',manifest=JSON.parse(fs.readFileSync(root+'runtime.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files={};
for(const tracked of [false,true]){
 const suffix=tracked?'-tracked':'',input=`wdosbox-x-rollback${suffix}.wasm`,name=`wdosbox-x-stage${suffix}.wasm`;
 const bytes=fs.readFileSync(root+input);
 if(sha(bytes)!==manifest.files[input])throw Error('Original core identity mismatch');
 const m=b.readBinary(bytes);m.setFeatures(b.Features.All & ~b.Features.CompactImports);
 // Write journaling renumbers functions; these are separately pinned inputs.
 const fn=m.getFunction(tracked?'1757':'2589'),info=b.getFunctionInfo(fn),text=b.emitText(info.body);
 if(b.expandType(info.params).length!==3||info.results!==b.none||
   info.vars.length!==3||(text.match(/call_indirect/g)||[]).length!==4||!text.includes('(i32.const 65535)')||
   !text.includes('(i32.const 22)'))throw Error('Pinned IO dispatcher changed');
 m.addFunctionImport('th05_stage','env','th05_stage',b.createType([b.i32,b.i32]),b.none);
 const arg=n=>m.local.get(n,b.i32),c=n=>m.i32.const(n);
 const marker=m.i32.and(m.i32.lt_u(m.i32.sub(arg(0),c(0x7fe0)),c(5)),m.i32.eq(arg(2),c(4)));
 b.Function.setBody(fn,m.block(null,[m.if(marker,m.block(null,[m.call('th05_stage',[arg(0),arg(1)],b.none),m.return()])),info.body]));
 if(!m.validate())throw Error('Invalid observation core');
 const output=m.emitBinary();m.dispose();fs.writeFileSync(root+name,output);files[name]=sha(output);
 console.log(name,output.length,files[name]);
}
fs.writeFileSync(root+'stage-runtime.json',JSON.stringify({...manifest,stageObservation:1,files:{...manifest.files,...files}},null,2)+'\n');
