// Runs isolated probes serially. No listener and no production publication.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const cases={
 'cn2-stage2':{language:'cn',players:2,stage:1,steps:1200},
 'jp2-stage3':{language:'jp',players:2,stage:2,steps:3600},
 'cn2-stage4':{language:'cn',players:2,stage:3,steps:1800},
 'jp3-stage4':{language:'jp',players:3,stage:3,steps:2400,characters:'3,0,2'},
 'jp2-stage5':{language:'jp',players:2,stage:4,steps:1800},
 'cn3-stage6':{language:'cn',players:3,stage:5,steps:2400},
 'corrupt-input':{language:'cn',players:2,stage:1,steps:1200,corrupt:true},
};
const selected=process.argv.slice(2),names=selected.length?selected:Object.keys(cases),results=[];
if(names.some(name=>!cases[name]))throw Error('Unknown probe case');
for(const name of names){
 const c=cases[name],env={...process.env};
 for(const key of Object.keys(env))if(key==='TH05_LANGUAGE'||key==='TH05_PLAYERS'||key.startsWith('TH05_STAGE'))delete env[key];
 Object.assign(env,{TH05_LANGUAGE:c.language,TH05_PLAYERS:String(c.players),TH05_STAGE:String(c.stage),
   TH05_STAGE_STEPS:String(c.steps),TH05_STAGE_PATTERN:'1',TH05_STAGE_CHARACTERS:c.characters||Array.from({length:c.players},(_,n)=>n).join(','),
   TH05_STAGE_CORRUPT_INPUT:c.corrupt?'1':'0'});
 console.log('RUN',name);
 const run=spawnSync(process.execPath,[path.join(__dirname,'test_stage_replay.cjs')],{cwd:root,env,stdio:'inherit',timeout:300000});
 const file=path.join(root,'reports',`stage-replay-probe-v2-${c.language}-${c.players}-${c.stage}-pattern${c.corrupt?'-corrupt':''}.json`);
 const r=run.status===0&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
 results.push({name,passed:run.status===0&&r?.passed===true,exitCode:run.status,error:run.error?.message,
   compared:r?.compared,descriptorBytes:r?.descriptorBytes,activeWorld:r?.activeWorld,resources:r?.resources});
 if(!results.at(-1).passed)break;
}
const passed=results.length===names.length&&results.every(r=>r.passed);
fs.writeFileSync(path.join(root,'reports/stage-replay-probe-matrix.json'),JSON.stringify({schema:1,passed,requested:names,results},null,2));
if(!passed)process.exitCode=1;
