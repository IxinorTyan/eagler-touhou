// Add a synchronous, experiment-only init marker import to the pinned core.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import b from '../../th04-coop-lab/build/binaryen-132/package/index.js';
const bytes=fs.readFileSync('web/vendor/dosbox-net/wdosbox-x-rollback.wasm');
const expected=JSON.parse(fs.readFileSync('web/vendor/dosbox-net/runtime.json')).files['wdosbox-x-rollback.wasm'];
if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Pinned core identity changed');
const m=b.readBinary(bytes);m.setFeatures(b.Features.All & ~b.Features.CompactImports);
// Pinned Asyncify IO_WriteDefault (JSPI numbering is different).
const f=m.getFunction('2589'),info=b.getFunctionInfo(f),body=b.emitText(info.body);
if(b.expandType(info.params).length!==3||info.results!==b.none||info.vars.length!==3||
   (body.match(/call_indirect/g)||[]).length!==4||!body.includes('(i32.const 65535)'))throw Error('IO dispatcher changed');
m.addFunctionImport('th05_stage','env','th05_stage',b.createType([b.i32,b.i32]),b.none);
const arg=i=>m.local.get(i,b.i32),c=n=>m.i32.const(n);
const marker=m.i32.and(m.i32.lt_u(m.i32.sub(arg(0),c(0x7fe0)),c(4)),m.i32.eq(arg(2),c(4)));
b.Function.setBody(f,m.block(null,[m.if(marker,m.block(null,[m.call('th05_stage',[arg(0),arg(1)],b.none),m.return()])),info.body]));
if(!m.validate())throw Error('Invalid probe core');
const output=m.emitBinary();m.dispose();
fs.writeFileSync('build/stage-replay-probe/probe.wasm',output);
console.log('Built isolated stage probe core',output.length);
