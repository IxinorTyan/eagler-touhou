import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export async function adaptRuntime({patch,replaceOnce,output,port,web,runtime,repo,files}) {
  const replace=(text,from,to)=>replaceOnce(text,from,to,from.slice(0,70));
  await patch('solo.js',text=>{
    text=replace(text,'let base=0;for(const key of held)base|=keys[key];','let base=globalThis.__eaglerPC98Input.sample();');
    text=replace(text,'const touch=unpackTouch(player.pack(value));','const touch=globalThis.__eaglerPC98Input.motion();');
    text=replace(text,'player.alwaysPoint()||activePractice&&practiceUI.options.alwaysPoint','globalThis.__eaglerPC98Options().alwaysHitbox');
    text=replace(text,'function failure(error){','function failure(error){\n  globalThis.__eaglerPC98Emit({event:"error",message:error.message});');
    text=replace(text,'function endSession(){','async function endSession(){\n  await managedNaturalExit();');
    text=replace(text,"$('replay-save-dialog').showModal();","void managedSaveReplay(blob);");
    return text;
  });
  await writeFile(resolve(output,'solo.js'),await readFile(resolve(output,'solo.js'),'utf8')+'\n'+await readFile(resolve(port,'web/managed-solo-api.js'),'utf8'));
  await patch('dosbox-runtime.js',text=>{
    text=replace(text,"if(data.type==='game-exit'){api.stop();api.onExit?.();return;}","if(data.type==='game-exit'){void api.exportUserFiles().then(()=>{api.onExit?.();api.stop();}).catch(fail);return;}");
    text=replace(text,"prepared,\n",`prepared,
    exportUserFiles(){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('存档导出超时'));},10000);pending.set(id,{resolve,reject,timer});worker.postMessage({type:'managed-files',id});});},
`);
    text=replace(text,"if(data.type==='qa-result')",`if(data.type==='managed-files'){const p=pending.get(data.id);if(p){clearTimeout(p.timer);pending.delete(data.id);Promise.all(data.files.map(file=>globalThis.__eaglerPC98Files.write(file.name,file.bytes))).then(()=>p.resolve(),p.reject);}return;}
    if(data.type==='qa-result')`);
    return replace(text,'files=gameFiles(disk,{solo});',`files=gameFiles(disk,{solo});
    for(const [name,bytes]of globalThis.__eaglerPC98Files.memory)if(['GENSOU.SCR','MIKO.CFG'].includes(name)){const path='game/KAIKI/'+name,file=files.find(f=>f.path===path);if(file)file.contents=bytes.slice();else files.push({path,contents:bytes.slice()});}
`);
  });
  await patch('dosbox-worker.js',text=>replace(text,"onmessage=async({data})=>{try{",`onmessage=async({data})=>{try{
  if(data.type==='managed-files'){
    const files=[];for(const name of ['GENSOU.SCR','MIKO.CFG'])files.push({name,bytes:await ci.fsReadFile('game/KAIKI/'+name)});
    send('managed-files',{id:data.id,files});return;
  }
`));
  await patch('preload-cache.js',text=>replace(text,'if(!globalThis.indexedDB){resolve(null);return;}','if(globalThis.__eaglerPC98Content||!globalThis.indexedDB){resolve(null);return;}'));
  await patch('bgm-version.js',text=>text.replace(/export async function loadMidiTracks\(signal\)\{[\s\S]*?\n\}/,'export async function loadMidiTracks(){return {};}'));
  await patch('lan.js',text=>{
    text="import {createManagedTransport} from './managed-transport.mjs';\nimport {packTouch} from './touch-input.js';\nlet managedTransport, managedEnding;\n"+text;
    const start=text.indexOf('  let directRelay=room.transport');const end=text.indexOf('  bootTimeout=setTimeout',start);
    if(start<0||end<0)throw Error('TH05 connect source changed');
    text=text.slice(0,start)+`  transport='rtc';rtcPreparing=false;channel=meshChannel();
  managedTransport=createManagedTransport(globalThis.__eaglerPC98Options(),roles,error=>void managedAPI.end(error.message,false));
  for(const role of remoteRoles()){
    peers.set(role,{lastMessage:performance.now(),suspectAt:null,channel:null});
    const value=managedTransport.channelFor(role);value.ordered=true;value.maxRetransmits=null;value.maxPacketLifeTime=null;
    attachChannel(value,role);
  }
  managedTransport.connect();
`+text.slice(end);
    text=replace(text,"if(room?.transport==='relay'){switchRelay();return;}\n  await Promise.all(remoteRoles().filter(role=>roles.indexOf(identity.role)<roles.indexOf(role)).map(role=>offerPeer(peers.get(role))));",'');
    text=replace(text,'const sampled=player.sample(buttons());','const sampled=globalThis.__eaglerPC98Input.sample();');
    text=replace(text,'player.pack((sampled&~128)|control)',"packTouch((sampled&~128)|control,{...globalThis.__eaglerPC98Input.motion(),alwaysPoint:!!globalThis.__eaglerPC98Options().alwaysHitbox})");
    text=replace(text,'async function api(action,extra={},identity=auth){',"async function api(action,extra={},identity=auth){throw Error('房间由主项目管理：'+action);");
    text=replace(text,'async function finish(reason,notify=true,flush=true,keepRoom=true,snapshot=null){',"async function finish(reason,notify=true,flush=true,keepRoom=true,snapshot=null){return managedAPI.end(reason,false);");
    text=replace(text,"finish('已从游戏暂停菜单退出，本局结束。',true,false);","void managedAPI.end('已从游戏暂停菜单退出，本局结束。',true);");
    text=replace(text,'function networkFailure(message,detail={}){','function networkFailure(message,detail={}){void managedAPI.end(message,false);return;');
    text=replace(text,'function closeTransport(){','function closeTransport(){\n  managedTransport?.close();managedTransport=null;');
    text=replace(text,'function repairPeer(role){','function repairPeer(role){return;');
    text=replace(text,"addEventListener('blur',()=>{clearInputs();if(running&&!paused){controls|=PAUSE;schedule(0);}});","addEventListener('blur',clearInputs);");
    text=replace(text,"document.addEventListener('visibilitychange',()=>{clearInputs();if(document.hidden&&running&&!paused){controls|=PAUSE;schedule(0);}});","document.addEventListener('visibilitychange',clearInputs);");
    text=replace(text,"if(!auth)return;const data=JSON.stringify({...auth,protocol:PROTOCOL});navigator.sendBeacon('/api/leave',new Blob([data],{type:'application/json'}));","managedAPI.stop();");
    const begin=text.lastIndexOf("try{\n  const response=await fetch('/api/version')");const finish=text.indexOf('\nrender();historyUI();',begin);
    if(begin<0||finish<0)throw Error('TH05 standalone version source changed');
    return text.slice(0,begin)+"version={build:'eagler-th05/1',relayAvailable:true,historyAvailable:false};network='public-rtc';"+text.slice(finish);
  });
  await writeFile(resolve(output,'lan.js'),await readFile(resolve(output,'lan.js'),'utf8')+'\n'+await readFile(resolve(port,'web/managed-room-api.js'),'utf8'));
  // This generation owns TH05's native title implementation only.
  await patch('room-title-worker.js',text=>{
    const start=text.indexOf("  } else {\n    const {DOSBoxPC98}");const end=text.indexOf('\n  globalThis.onmessage = dispatch;',start);
    if(start<0||end<0)throw Error('TH05 title branch changed');
    text=text.slice(0,start)+"  } else throw Error('TH05 title only');"+text.slice(end);
    text=replace(text,'async function boot({game, canvas, disk, wasmBinary, module})','async function boot({game, canvas, disk, wasmBinary, module, managedTitle=false})');
    return replace(text,"send('ready', {frames, pixels, program: m.UTF8ToString(m._emGetRunningProgram())});","send('ready', {frames, pixels, program: m.UTF8ToString(m._emGetRunningProgram())});\n  if(managedTitle)return;");
  });
  let room=await readFile(resolve(web,'lan.html'),'utf8');room=room.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  await writeFile(resolve(output,'managed-room.html'),room);runtime.push('managed-room.html');
  for(const name of await files(resolve(port,'web')))if(!name.endsWith('-api.js')){await copyFile(resolve(port,'web',name),resolve(output,name));runtime.push(name);}
  for(const name of ['directory-keyboard.mjs','keyboard-input-bridge.mjs','keyboard-owners.mjs','direct-input-bridge.mjs']){await copyFile(resolve(repo,'common/browser',name),resolve(output,name));runtime.push(name);}
  let html=await readFile(resolve(web,'solo.html'),'utf8');
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  html=html.replace('<head>','<head><meta name="eagler-data-provider" content="retail-memory">');
  html=html.replace('</head>',`<style>body>*:not(main),main>*:not(.local-layout),.local-layout>*:not(.game-column),.game-column>*:not(#player),.player-toolbar,.player-actions,.player-movement,.player-note,.touch-surface,[class^="touch-"],[data-layout-control],.practice-panel{display:none!important}html,body{margin:0;background:#000}#player.immersive{position:fixed;inset:0}.player-stage{width:100%;height:100%}</style><script type="module" src="managed-shell.mjs"></script></head>`);
  await writeFile(resolve(output,'th05.html'),html);runtime.push('th05.html');
  await patch('site.css',text=>replace(text,"url('assets/launcher-background.webp')",'none'));
  // Make known vendor bases explicit for the generation closure validator.
  for(const name of ['dosbox-runtime.js','dosbox-worker.js','lan.js'])await patch(name,text=>text.replace(/new URL\('([^']+)',vendor\)/g,(_all,file)=>`new URL('./vendor/${name==='lan.js'?'dosbox-net':'dosbox-x'}/${file}',${name==='dosbox-worker.js'?'data.base':'import.meta.url'})`));
}
