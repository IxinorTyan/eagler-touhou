// One synchronous import on the unused replay marker ports. No clock tap,
// JSPI boundary replacement, snapshot instrumentation or input buffering.
import fs from 'node:fs';import {createHash} from 'node:crypto';
import b from '../../th04-coop-lab/build/binaryen-132/package/index.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=fs.readFileSync('web/vendor/dosbox-x/wdosbox-x-fast.wasm');
if(hash(bytes)!=='7833111cfbea4afd94bcd7e3271679dc02ac1ae057063b7d924b74f7f8c76fc1')throw Error('Unaudited source core');
const m=b.readBinary(bytes);m.setFeatures(b.Features.All&~b.Features.CompactImports);
const f=m.getFunction('9160'),info=b.getFunctionInfo(f);
if(b.expandType(info.params).length!==3||info.results!==b.none)throw Error('IO_WriteDefault shape changed');
m.addFunctionImport('th05_replay','env','th05_replay',b.createType([b.i32,b.i32]),b.none);
const arg=i=>m.local.get(i,b.i32),c=n=>m.i32.const(n);
const marker=m.i32.and(m.i32.lt_u(m.i32.sub(arg(0),c(0x7ff0)),c(7)),m.i32.eq(arg(2),c(4)));
b.Function.setBody(f,m.block(null,[m.if(marker,m.block(null,[m.call('th05_replay',[arg(0),arg(1)],b.none),m.return()])),info.body]));
if(!m.validate())throw Error('Invalid replay core');
const out=m.emitBinary();m.dispose();
if(!WebAssembly.validate(out))throw Error('Replay core unsupported by the local JS engine');
fs.writeFileSync('web/vendor/dosbox-x/wdosbox-x-replay.wasm',out);
fs.writeFileSync('web/frame-replay-core.json',JSON.stringify({source:hash(bytes),sha256:hash(out),url:'vendor/dosbox-x/wdosbox-x-replay.wasm',ioFunction:'9160',ports:[0x7ff0,0x7ff1,0x7ff2,0x7ff3,0x7ff4,0x7ff5,0x7ff6]},null,2)+'\n');
console.log('Built isolated synchronous frame observation core',hash(out));
