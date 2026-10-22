// Read-only browser HUD. Keep DOS memory, the disk and replay inputs untouched.
import {powerBarGlyphs} from './solo-boss-glyphs.js';
const bosses=[['RIKA',2261],['MEIRA',2400],['STONES',1450],['MARISA',900],['MIMA',4700],['SIGMA',8500]];
const phases={4:[600,700,800,1500,1100],5:[1800,1800,1800,1800,1300]};
const stones=[140,140,120,120,930];
// Integer 8x16 cells, like native PC-98 sidebar text. Browser fillText adds
// antialiasing before the 640x400 canvas is enlarged, which blurs the strokes.
const captionGlyphs={
  A:[14,17,17,31,17,17,17],E:[31,16,16,30,16,16,31],
  G:[14,17,16,23,17,17,14],I:[14,4,4,4,4,4,14],
  K:[17,18,20,24,20,18,17],L:[16,16,16,16,16,16,31],
  M:[17,27,21,21,17,17,17],N:[17,25,21,19,17,17,17],
  O:[14,17,17,17,17,17,14],R:[30,17,17,30,20,18,17],
  S:[15,16,16,14,1,1,30],T:[31,4,4,4,4,4,4],
  Y:[17,17,10,4,4,4,4],
};

export function drawBossCaption(context,text,x,y,color='#fff'){
  context.fillStyle=color;
  for(const letter of text){
    const glyph=captionGlyphs[letter];
    if(glyph)for(let row=0;row<7;row++)for(let col=0;col<5;col++){
      if(glyph[row]&(16>>col))context.fillRect(x+col+1,y+row*2+1,1,2);
    }
    x+=8;
  }
}

export function drawBossBar(context,bar,x,y){
  // Use the game's own 16x16 partial-fill gaiji, just like the Power display.
  // Empty space stays transparent; there is no browser-style gray track.
  const power=Math.ceil(bar*80/128);
  const level=[0,1,2,2,3,3,4,4,5,5,6,6,6,7,7,7,8,8,8,8,9][power>>2];
  context.fillStyle=['#f00','#f00','#f00','#f0f','#f0f','#00f','#0f0','#0ff','#ff0','#fff'][level];
  for(let cell=0;cell<5;cell++){
    const width=Math.min(16,power-cell*16);if(width<=0)break;
    const glyph=powerBarGlyphs[width-1];
    for(let row=0;row<16;row++)for(let col=0;col<16;col++){
      if(glyph[row]&(0x8000>>col))context.fillRect(x+cell*16+col,y+row,1,1);
    }
  }
}

export function readSoloBoss(heap,data,mode){
  if(!heap||!Number.isInteger(data)||data<0||data+0x91fa>heap.length||![1,2].includes(mode))return null;
  const view=new DataView(heap.buffer,heap.byteOffset,heap.byteLength),stage=heap[data+0x8f5];
  const update=view.getUint32(data+0x1a0c,true);
  if(stage>=bosses.length||heap[data+0x19f6]!==1||!update||update!==view.getUint32(data+0x1a10,true)||
    stage!==2&&heap[data+0x2bfa]!==0)return null;
  const [name,max]=bosses[stage],damage=Math.max(0,view.getInt16(data+0x2bea,true));
  let current;
  if(stage===2){
    current=stones.reduce((total,hp,i)=>total+(heap[data+0x2bf0+i]>=2?0:Math.max(0,hp-view.getInt16(data+0x2bd4+i*2,true))),0);
  }else if(phases[stage]){
    const phase=Math.min(10,stage===4?view.getUint16(data+0x91f8,true):heap[data+0x7b42]);
    const index=Math.floor(phase/2),limits=phases[stage];
    current=limits.slice(index).reduce((sum,hp)=>sum+hp,0)-(phase%2?Math.min(damage,limits[index]):0);
  }else current=Math.max(0,max-damage);
  current=Math.max(0,Math.min(max,current));
  return {stage,name,current,max,bar:Math.ceil(current*128/max)};
}

export function mountSoloBossHud(screen){
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;
  canvas.className='solo-boss-hud';canvas.hidden=true;canvas.setAttribute('aria-hidden','true');screen.append(canvas);
  const context=canvas.getContext('2d');
  let previous='',key='',bar=0,tick=-1;
  return {
    update(boss,generation,ticks){
      if(!boss){canvas.hidden=true;previous=key='';bar=0;tick=-1;return;}
      const nextKey=`${generation}:${boss.stage}`;
      if(key!==nextKey||ticks<tick){key=nextKey;bar=0;tick=ticks;}
      // Fill on entry using native game ticks, so pause and fast-forward agree.
      bar=boss.bar<=bar?boss.bar:Math.min(boss.bar,bar+Math.max(0,ticks-tick));tick=ticks;
      const next=`${key}:${bar}`;
      canvas.hidden=false;if(next===previous)return;previous=next;
      context.clearRect(0,0,640,400);
      drawBossCaption(context,boss.name,496,144);
      drawBossCaption(context,'ENEMY',448,160,'#ff0');
      drawBossBar(context,bar,496,160);
    },
    hide(){this.update(null);},
  };
}

// Permit only the reviewed before/after fingerprints for this visual update.
// Any later simulation/runtime change produces a different current identity.
export async function compatibleSoloReplay(recorded,current){
  if(recorded===current)return true;
  try{
    const response=await fetch(new URL('./solo-boss-hud-replay.json',import.meta.url),{cache:'no-cache'});
    if(!response.ok)return false;
    const pair=await response.json();return pair.previous===recorded&&pair.current===current;
  }catch{return false;}
}
