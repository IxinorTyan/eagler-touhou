export const COOP_INPUT_OFFSET = 182;
export const COOP_PLAYERS_OFFSET = 186;
export const COOP_PLAYER_STRIDE = 12;
// P3 extends the bridge without moving the existing P1/P2/menu fields.
export const coopInputOffset=slot=>slot===2?222:COOP_INPUT_OFFSET+slot*2;
export const coopPlayerOffset=slot=>slot===2?224:COOP_PLAYERS_OFFSET+slot*COOP_PLAYER_STRIDE;
const bindings = [
  {ArrowLeft:1,ArrowRight:2,KeyZ:4,KeyX:8},
  {KeyA:1,KeyD:2,KeyJ:4,KeyK:8},
  {KeyF:1,KeyH:2,KeyT:4,KeyY:8},
];

export function readCoopState(view, bridge) {
  const count=view.getUint16(bridge+180,true);
  if(![2,3].includes(count))return null;
  return Array.from({length:count},(_,slot)=>{
    const at=bridge+coopPlayerOffset(slot);
    return {left:view.getInt16(at,true),lives:view.getInt16(at+2,true),
      bombs:view.getInt16(at+4,true),ghost:!!view.getUint16(at+6,true),
      invincibility:view.getUint16(at+8,true),rescues:view.getUint16(at+10,true)};
  });
}

// Track each player's loss separately; protection must not conceal the hit.
export function createCoopFeedback() {
  let previous=null,stage=null;
  const events=[null,null,null];
  return (state,now)=>{
    if(!state?.players){previous=null;stage=null;events.fill(null);return events;}
    if(stage!==state.stage || ![1,2].includes(state.phase)) {
      events.fill(null);previous=null;
    }
    if(previous&&previous.length===state.players.length)for(let i=0;i<state.players.length;i++) {
      const p=state.players[i],before=previous[i];
      if(p.ghost&&!before.ghost)events[i]={text:'中弹：变为幽灵',until:now+3000,hit:true};
      else if(p.lives<before.lives)events[i]={text:`中弹 −${before.lives-p.lives} 残机`,until:now+3000,hit:true};
      else if(p.rescues>before.rescues)events[i]={text:'已获救',until:now+2000,hit:false};
    }
    for(let i=0;i<3;i++)if(events[i]?.until<=now)events[i]=null;
    previous=state.players.map(p=>({...p}));stage=state.stage;
    return events;
  };
}

export function createCoopControls({enabled, write, menu,count=()=>2}) {
  const keys=new Set(),touch=new Map(),pending=[0,0,0],external=[0,0,0],forwarded=new Map();
  function nativeKey(code,down){
    const event=new KeyboardEvent(down?'keydown':'keyup',{code,keyCode:{ArrowLeft:37,ArrowRight:39,KeyZ:90,KeyX:88}[code],bubbles:true});
    Object.defineProperty(event,'coopMenuForward',{value:true});
    document.getElementById('canvas').dispatchEvent(event);
  }
  function buttons(slot) {
    let value=external[slot];
    for(const code of keys)value|=bindings[slot][code]||0;
    for(const code of touch.values())value|=bindings[slot][code]||0;
    return value;
  }
  function flush() {write(Array.from({length:count()},(_,i)=>buttons(i)|pending[i]));}
  function press(code) {
    for(let slot=0;slot<count();slot++)pending[slot]|=bindings[slot][code]||0;
    flush();
  }
  function release() {for(const code of forwarded.values())nativeKey(code,false);forwarded.clear();keys.clear();touch.clear();pending.fill(0);external.fill(0);write(Array(count()).fill(0));}
  function consumed() {pending.fill(0);flush();}
  document.addEventListener('keydown',event=>{
    if(event.coopMenuForward)return;
    if(!enabled()||event.target.closest('input,select,textarea,button'))return;
    const bound=bindings.slice(0,count()).some(binding=>binding[event.code]);
    if(!bound)return;
    // P1 keys also operate the native title, route and pause menus. P2
    // equivalents may confirm/move through those menus while outside play.
    if(menu()&&(bindings[1][event.code]||(count()===3&&bindings[2][event.code]))) {
      const map={KeyA:'ArrowLeft',KeyD:'ArrowRight',KeyJ:'KeyZ',KeyK:'KeyX',KeyF:'ArrowLeft',KeyH:'ArrowRight',KeyT:'KeyZ',KeyY:'KeyX'};
      forwarded.set(event.code,map[event.code]);nativeKey(map[event.code],true);
    }
    keys.add(event.code);press(event.code);event.preventDefault();
  },true);
  document.addEventListener('keyup',event=>{
    if(event.coopMenuForward)return;
    keys.delete(event.code);
    if(forwarded.has(event.code)){nativeKey(forwarded.get(event.code),false);forwarded.delete(event.code);}
    flush();
  },true);
  for(const button of document.querySelectorAll('[data-code]')) {
    button.addEventListener('pointerdown',event=>{
      if(!enabled())return;
      touch.set(event.pointerId,button.dataset.code);press(button.dataset.code);
    });
    const end=event=>{touch.delete(event.pointerId);flush();};
    button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);
    button.addEventListener('lostpointercapture',end);
  }
  addEventListener('blur',release);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
  function setExternal(values){
    for(let i=0;i<count();i++){
      const next=values[i]&31;
      pending[i]|=(next&~external[i])&28;
      external[i]=next;
    }
    flush();
  }
  return {flush,release,consumed,setExternal};
}
