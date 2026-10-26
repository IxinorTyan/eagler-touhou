// Adapt only the pinned reference's two existing equivalent idle helpers.
// Registration supplies the current TH05 guest linear PC; default is disabled.
// Cycle arithmetic, final real iterations, CPU mode and direct-RAM guards are
// unchanged. No instruction, interrupt or virtual-time budget is removed.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import b from '../../th04-coop-lab/build/binaryen-132/package/index.js';
const input=new URL('../../th04-coop-lab/build/native-scheduler/runtime-tablet/wdosbox-x-rollback.wasm',import.meta.url);
const bytes=fs.readFileSync(input),sha256=createHash('sha256').update(bytes).digest('hex');
if(sha256!=='318af02f807f494613083c444a35c1abcde2823a9ad2c81a160e785d8d7d3948')throw Error('Reference changed; audit the new build separately');
const m=b.readBinary(bytes);m.setFeatures(b.Features.All);
const schema={Block:['children'],If:['condition','ifTrue','ifFalse'],Loop:['body'],Break:['condition','value'],Switch:['condition','value'],Call:['operands'],CallIndirect:['target','operands'],LocalGet:[],LocalSet:['value'],GlobalGet:[],GlobalSet:['value'],Load:['ptr'],Store:['ptr','value'],Const:[],Unary:['value'],Binary:['left','right'],Select:['ifTrue','ifFalse','condition'],Drop:['value'],Return:['value'],MemorySize:[],MemoryGrow:['delta'],Nop:[],Unreachable:[],Try:['body','catchBodies'],Throw:['operands'],Rethrow:[],Pop:[],RefNull:[],RefFunc:[],RefIsNull:['value'],RefEq:['left','right'],MemoryCopy:['dest','source','size'],MemoryFill:['dest','value','size'],MemoryInit:['dest','offset','size'],DataDrop:[]};
const kinds=new Map(Object.entries(schema).map(([kind,fields])=>[b[kind+'Id'],{kind,fields}]));

const name='th05_idle_pc',c=n=>m.i32.const(n),pc=()=>m.global.get(name,b.i32);
m.addGlobal(name,b.i32,true,c(-1));
m.addGlobalExport(name,'__rollback_g_th05_idle_pc');
// Keep every code read on one direct-mapped RAM page and below video memory.
const arg=()=>m.local.get(0,b.i32);
const valid=m.i32.and(m.i32.and(m.i32.ge_u(arg(),c(0x1000)),m.i32.le_u(arg(),c(0x90000))),m.i32.le_u(m.i32.and(arg(),c(4095)),c(4096-9)));
m.addFunction('th05_set_idle_pc',b.i32,b.none,[],m.global.set(name,m.select(valid,arg(),c(-1),b.i32)));
m.addFunctionExport('th05_set_idle_pc','th05_set_idle_pc');
const audit=[];
for(const functionName of ['6589','6590']){
 const f=b.getFunctionInfo(m.getFunction(functionName)),counts={pc:0,tlb:0,code0:0,code4:0,code8:0,mov:0,cmp:0,counter:0,delay:0};
 const work=[f.body];
 while(work.length){
  const ref=work.pop(),id=b.getExpressionId(ref),type=kinds.get(id);
  if(!type)throw Error('Unhandled expression '+id);
  if([b.UnreachableId,b.PopId,b.NopId].includes(id))continue;
  const info=b.getExpressionInfo(ref);
  // Traverse only original children, never newly injected expressions.
  for(const key of type.fields){const v=info[key];for(const child of Array.isArray(v)?v:[v])if(child)work.push(child);}
  if(id===b.BinaryId){
   for(const side of ['left','right']){
    if(b.getExpressionId(info[side])!==b.ConstId)continue;
    const value=b.getExpressionInfo(info[side]).value,other=info[side==='left'?'right':'left'];
    const replace=expr=>b.Binary[side==='left'?'setLeft':'setRight'](ref,expr);
    if(value===113269){
     if(info.op!==b.NeInt32||b.getExpressionId(other)!==b.LocalGetId)throw Error('PC guard changed');
     replace(pc());counts.pc++;
    }
    for(const [oldValue,newValue,key,op]of [[0x3b2ab2a1,0x3b267aa1,'mov',b.NeInt32],[0x72539006,0x72576a06,'cmp',b.NeInt32],[0x2ab2,0x267a,'counter',b.AddInt32],[0x5390,0x576a,'delay',b.AddInt32]])if(value===oldValue){
     if(info.op!==op)throw Error('Idle operand changed: '+key);
     replace(c(newValue));counts[key]++;
    }
   }
  }
  if(id===b.LoadId){
   if(b.getExpressionId(info.ptr)===b.ConstId&&b.getExpressionInfo(info.ptr).value===6772448){
    if(info.offset!==0||info.bytes!==4)throw Error('Code TLB shape changed');
    // Original TLB base 6772340 + (113269 >> 12) * 4.
    b.Load.setPtr(ref,m.i32.add(c(6772340),m.i32.shl(m.i32.shr_u(pc(),c(12)),c(2))));counts.tlb++;
   }
   if([113269,113273,113277].includes(info.offset)){
    const delta=info.offset-113269;
    if(b.getExpressionId(info.ptr)!==b.LocalGetId||info.bytes!==(delta===8?1:4))throw Error('Code byte guard changed');
    b.Load.setPtr(ref,m.i32.add(info.ptr,pc()));b.Load.setOffset(ref,delta);counts['code'+delta]++;
   }
  }
 }
 if(Object.values(counts).some(n=>n!==1))throw Error('Expected exactly one complete idle helper per interpreter: '+JSON.stringify(counts));
 audit.push({function:functionName,counts});
}
if(!m.validate())throw Error('Invalid TH05 idle core');
const output=new URL('../build/native-scheduler/th05-idle.wasm',import.meta.url);
fs.mkdirSync(new URL('../build/native-scheduler/',import.meta.url),{recursive:true});
const result=m.emitBinary();fs.writeFileSync(output,result);m.dispose();
const report={source:sha256,output:createHash('sha256').update(result).digest('hex'),audit,
 guestCode:'a17a263b066a5772f7',guestNearOffset:0x11,registration:'current verified MAIN CS base + 0x11',
 guards:'disabled until registration; RAM page/range; existing real-mode/16-bit/VM86/trap/TLB/code/waiting guards',
 budget:'unchanged reference arithmetic; final complete iterations execute normally',runtimeTested:false};
fs.writeFileSync(new URL('../reports/th05-idle-build-20261015.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
