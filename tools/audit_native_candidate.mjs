// Inspect the pinned source-built reference before isolating it for TH05.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import b from '../../th04-coop-lab/build/binaryen-132/package/index.js';
const input=new URL('../../th04-coop-lab/build/native-scheduler/runtime-tablet/wdosbox-x-rollback.wasm',import.meta.url);
const bytes=fs.readFileSync(input),sha256=createHash('sha256').update(bytes).digest('hex');
if(sha256!=='318af02f807f494613083c444a35c1abcde2823a9ad2c81a160e785d8d7d3948')throw Error('Reference changed; audit the new build separately');
const m=b.readBinary(bytes);m.setFeatures(b.Features.All);
const schema={Block:['children'],If:['condition','ifTrue','ifFalse'],Loop:['body'],Break:['condition','value'],Switch:['condition','value'],Call:['operands'],CallIndirect:['target','operands'],LocalGet:[],LocalSet:['value'],GlobalGet:[],GlobalSet:['value'],Load:['ptr'],Store:['ptr','value'],Const:[],Unary:['value'],Binary:['left','right'],Select:['ifTrue','ifFalse','condition'],Drop:['value'],Return:['value'],MemorySize:[],MemoryGrow:['delta'],Nop:[],Unreachable:[],Try:['body','catchBodies'],Throw:['operands'],Rethrow:[],Pop:[],RefNull:[],RefFunc:[],RefIsNull:['value'],RefEq:['left','right'],MemoryCopy:['dest','source','size'],MemoryFill:['dest','value','size'],MemoryInit:['dest','offset','size'],DataDrop:[]};
const kinds=new Map(Object.entries(schema).map(([kind,fields])=>[b[kind+'Id'],{kind,fields}]));
const matches=[],disable=process.argv.includes('--disable-th04-idle');
for(let i=0;i<m.getNumFunctions();i++){
 const f=b.getFunctionInfo(m.getFunctionByIndex(i)),work=f.body?[[f.body,[]]]:[];
 while(work.length){
  const [ref,parents]=work.pop(),id=b.getExpressionId(ref),type=kinds.get(id);
  if(!type)throw Error('Unhandled expression '+id);
  if([b.UnreachableId,b.PopId,b.NopId].includes(id))continue;
  const info=b.getExpressionInfo(ref);
  if(id===b.BinaryId&&[b.EqInt32,b.NeInt32].includes(info.op)){
   for(const side of ['left','right'])if(b.getExpressionId(info[side])===b.ConstId&&b.getExpressionInfo(info[side]).value===113269){
    const other=b.getExpressionInfo(info[side==='left'?'right':'left']);
    matches.push({function:f.name,op:info.op===b.EqInt32?'eq':'ne',other,parents:parents.slice(-3),...(other.ptr?{pointer:b.getExpressionInfo(other.ptr)}:{})});
    if(disable){
     if(info.op!==b.NeInt32||b.getExpressionId(info[side==='left'?'right':'left'])!==b.LocalGetId)throw Error('Idle guard shape changed');
     // In this pinned build these are the inverted guards of the full and
     // synchronous interpreters. Force the "not TH04 address" result true.
     // Only a local read is replaced; no memory, timing or write is added.
     b.Binary[side==='left'?'setRight':'setLeft'](ref,m.i32.const(0));
    }
   }
  }
  const parent={kind:type.kind,...(type.kind==='Break'?{name:info.name,condition:info.condition,value:info.value}:{}),...(type.kind==='Block'?{name:info.name,children:info.children.length}:{}),...(type.kind==='If'?{condition:info.condition}: {})};
  for(const field of type.fields){const value=info[field];for(const child of Array.isArray(value)?value:[value])if(child)work.push([child,[...parents.slice(-2),parent]]);}
 }
}
if(matches.length!==2)throw Error('Expected both full/synchronous idle guards');
if(disable){
 if(!m.validate())throw Error('Invalid isolated candidate');
 const output=new URL('../build/native-scheduler/no-th04-idle.wasm',import.meta.url);
 fs.mkdirSync(new URL('../build/native-scheduler/',import.meta.url),{recursive:true});
 fs.writeFileSync(output,m.emitBinary());
}
const report={sha256,disabled:!!disable,matches};
if(disable)fs.writeFileSync(new URL('../reports/native-idle-isolation-20261015.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));m.dispose();
