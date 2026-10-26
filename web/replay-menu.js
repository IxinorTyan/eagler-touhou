// Browser overlay only. The game is already held at its checked endpoint.
const pressed=new Set(),states=new Map();
function place(menu){
  const canvas=document.getElementById('canvas');if(!canvas)return;
  let r=canvas.getBoundingClientRect();
  if(r.top>=innerHeight||r.bottom<=0){canvas.scrollIntoView({block:'center',behavior:'instant'});r=canvas.getBoundingClientRect();}
  menu.style.setProperty('--menu-x',Math.max(0,r.left)+r.width/2+'px');
  menu.style.setProperty('--menu-y',Math.min(innerHeight-100,Math.max(100,r.top+r.height/2))+'px');
  menu.style.setProperty('--menu-width',Math.max(260,r.width-32)+'px');
}
function select(state,index){
  state.index=index;state.buttons.forEach((button,i)=>button.dataset.selected=String(i===index));
}
for(const id of ['save-dialog','end-dialog']){
  const menu=document.getElementById(id);if(!menu)continue;
  menu.classList.add('replay-menu');
  document.getElementById('game-stage')?.append(menu);
  const hint=document.createElement('p');hint.className='menu-help';hint.textContent='← → 选择　Z / Enter 确认';menu.append(hint);
  const state={menu,buttons:[...menu.querySelectorAll('button')],index:0,blocked:new Set()};states.set(menu,state);
  for(const [index,button]of state.buttons.entries()){
    button.addEventListener('pointerenter',()=>select(state,index));
    button.addEventListener('focus',()=>select(state,index));
  }
  new MutationObserver(()=>{if(menu.open){state.blocked=new Set(pressed);select(state,0);place(menu);}}).observe(menu,{attributes:true,attributeFilter:['open']});
}
for(const type of ['keydown','keyup'])addEventListener(type,event=>{
  const open=[...states.values()].find(s=>s.menu.open);
  if(type==='keyup'){pressed.delete(event.code);for(const s of states.values())s.blocked.delete(event.code);}
  else pressed.add(event.code);
  if(!open)return;
  // Let Tab retain the browser's accessible modal focus navigation.
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyZ','Enter','Space','KeyX','Escape'].includes(event.code))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(type!=='keydown'||event.repeat||open.blocked.size)return;
  if(['ArrowLeft','ArrowUp'].includes(event.code))select(open,(open.index+open.buttons.length-1)%open.buttons.length);
  else if(['ArrowRight','ArrowDown'].includes(event.code))select(open,(open.index+1)%open.buttons.length);
  else if(['KeyX','Escape'].includes(event.code)){
    select(open,open.buttons.length-1);
    // The save menu requires confirmation; playback Escape keeps its close shortcut.
    if(open.menu.id==='end-dialog')open.buttons[open.index].click();
  }else open.buttons[open.index].click();
},true);
addEventListener('blur',()=>{pressed.clear();for(const s of states.values())s.blocked.clear();});
for(const type of ['resize','scroll','fullscreenchange'])addEventListener(type,()=>{for(const s of states.values())if(s.menu.open)place(s.menu);},true);
