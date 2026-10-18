// Local presentation preference only; never included in game or room settings.
const storageKey='th05.bgmVersion';
let value='old';
try{value=localStorage.getItem(storageKey)==='new'?'new':'old';}catch{}
const listeners=new Set(),controls=new Set();
let needsRestart=false;
export const bgmVersion=()=>value;
export function onBgmVersion(callback){listeners.add(callback);return()=>listeners.delete(callback);}
function updateControls(){
  const mode=document.getElementById('audio-mode');
  if(value==='new'&&mode&&!mode.disabled&&mode.value!=='independent'){
    needsRestart=!!document.querySelector('#restart:not(:disabled)');
    mode.value='independent';mode.dispatchEvent(new Event('change'));
  }
  for(const select of controls){
    select.value=value;
    select.title=mode&&mode.value!=='independent'?'使用新版音乐需要独立 BGM；请重新启动游戏':'仅影响本机，自动保存';
    select.nextElementSibling.textContent=value==='new'&&mode&&(needsRestart||mode.value!=='independent')?' 需使用独立 BGM 并重新启动':'';
  }
}
export function setBgmVersion(next){
  next=next==='new'?'new':'old';
  if(next===value){updateControls();return;}
  value=next;try{localStorage.setItem(storageKey,value);}catch{}
  updateControls();for(const callback of listeners)callback(value);
}
window.addEventListener('storage',event=>{
  if(event.key===storageKey||event.key===null){
    let next='old';try{next=localStorage.getItem(storageKey)==='new'?'new':'old';}catch{}
    if(next!==value){value=next;updateControls();for(const callback of listeners)callback(value);}
  }
});
function mount(anchor){
  if(!anchor.matches('.player-toolbar')&&anchor.closest('.player-toolbar'))return;
  if('bgmVersionMounted' in anchor.dataset)return;
  anchor.dataset.bgmVersionMounted='';
  const label=document.createElement('label');label.className='player-volume bgm-version';label.textContent='本机音乐 ';
  const select=document.createElement('select');select.setAttribute('aria-label','本机音乐版本');
  for(const [id,text]of [['old','游戏原版'],['new','幺乐团专辑版']])select.add(new Option(text,id));
  select.style.cssText='width:auto;min-width:110px;font:inherit';select.value=value;
  select.onchange=()=>setBgmVersion(select.value);label.append(select,document.createElement('small'));controls.add(select);
  if(anchor.matches('.player-toolbar'))anchor.append(label);
  else (anchor.closest('label')||anchor).after(label);
  updateControls();
}
const targets='.player-toolbar,#music,#music-volume,#bgm-volume,#audio-mode';
function scan(root){
  const explicit=[...(root.matches?.('[data-bgm-version-control]')?[root]:[]),...(root.querySelectorAll?.('[data-bgm-version-control]')||[])];
  for(const select of explicit)if(!controls.has(select)){
    select.value=value;select.onchange=()=>setBgmVersion(select.value);controls.add(select);updateControls();
  }
  // Pages with a permanent control need no generated toolbar copy.
  if(document.querySelector('[data-bgm-version-control]'))return;
  if(root.matches?.(targets))mount(root);for(const anchor of root.querySelectorAll?.(targets)||[])mount(anchor);
}
function start(){
  scan(document);
  document.getElementById('restart')?.addEventListener('click',()=>{needsRestart=false;updateControls();});
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&!node.matches('.bgm-version'))scan(node);})
    .observe(document.body,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
