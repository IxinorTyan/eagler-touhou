// Reuse the frozen common core, adapt guarded idle fusion to TH05,
// then derive the tracked core from that final TH05 untracked binary.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),reference=path.resolve(root,'../th04-coop-lab');
const build=path.join(root,'build/native-scheduler'),runtime=path.join(build,'runtime');
const donor=path.join(reference,'build/native-scheduler/runtime-tablet');
const baseline=JSON.parse(fs.readFileSync(path.join(root,'reports/core-migration-baseline-20261015.json')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [name,expected]of Object.entries(baseline.reference_tablet_candidate))if(hash(fs.readFileSync(path.join(donor,name)))!==expected)throw Error('Frozen reference changed: '+name);
fs.mkdirSync(runtime,{recursive:true});
const relative=p=>path.relative(reference,p);
function run(file,args,extra={}){
 const result=spawnSync(file,args,{cwd:reference,env:{...process.env,BINARYEN_CORES:'2',...extra},encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true});
 if(result.error||result.status)throw result.error||Error(result.stderr||result.stdout);
 console.log(result.stdout.trim());
}
run(process.execPath,[path.join(__dirname,'build_th05_idle.mjs')]);
run(process.execPath,[path.join(reference,'tools/prepare_core_candidate.cjs'),path.join(build,'th05-idle.wasm'),path.join(runtime,'wdosbox-x-rollback.wasm')]);
fs.copyFileSync(path.join(donor,'dosbox-rollback.mjs'),path.join(runtime,'dosbox-rollback.mjs'));
run(process.execPath,[path.join(reference,'tools/build_dirty_core.mjs')],{
 CORE_INPUT:pathToFileURL(path.join(runtime,'wdosbox-x-rollback.wasm')).href,
 CORE_OUTPUT:pathToFileURL(path.join(build,'tracked-native.wasm')).href,
 CORE_PAGES_OUTPUT:pathToFileURL(path.join(build,'tracked-pages.json')).href,
});
const binaryen=path.join(reference,'build/binaryen-native-132/binaryen-version_132/bin');
run(path.join(binaryen,'wasm-opt.exe'),[path.join(build,'tracked-native.wasm'),'--all-features','--inlining','--optimize-instructions','--vacuum','-o',path.join(build,'tracked-inline.wasm')]);
run(process.execPath,[path.join(reference,'tools/prepare_core_candidate.cjs'),path.join(build,'tracked-inline.wasm'),path.join(runtime,'wdosbox-x-rollback-tracked.wasm')]);
run(process.execPath,[path.join(reference,'tools/prepare_dirty_runtime.cjs')],{
 DIRTY_SOURCE:relative(path.join(runtime,'dosbox-rollback.mjs')),
 DIRTY_RUNTIME_DIR:relative(path.join(build,'tracked-runtime')),
 DIRTY_PAGES:relative(path.join(build,'tracked-pages.json')),
});
fs.copyFileSync(path.join(build,'tracked-runtime/dosbox-rollback.mjs'),path.join(runtime,'dosbox-rollback-tracked.mjs'));
fs.copyFileSync(path.join(build,'tracked-runtime/snapshot-diff.wasm'),path.join(runtime,'snapshot-diff-tracked.wasm'));
const names=['dosbox-rollback.mjs','dosbox-rollback-tracked.mjs','wdosbox-x-rollback.wasm','wdosbox-x-rollback-tracked.wasm','snapshot-diff-tracked.wasm'];
const metadata={project:'th05-pc98-fast',accepted:false,reference:baseline.reference_tablet_candidate,
 th04_idle_fusion:false,th05_idle_fusion:true,native_scheduling:true,guarded_synchronous_cpu:true,chunked_memcmp:true,pc98_planar_table:true,native_frame_presentation:false,
 tracked_derived_from:hash(fs.readFileSync(path.join(runtime,'wdosbox-x-rollback.wasm'))),
 files:Object.fromEntries(names.map(name=>[name,hash(fs.readFileSync(path.join(runtime,name)))]))};
fs.writeFileSync(path.join(runtime,'candidate.json'),JSON.stringify(metadata,null,2)+'\n');
console.log('Built isolated TH05 candidate; release web assets unchanged:',runtime);
