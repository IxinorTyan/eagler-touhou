import {hudDigits} from './hud-digits.js';
import {enemyGlyphs} from './boss-hud-glyphs.js';

// Presentation only: all addresses below are DS offsets in the audited TH05
// MAIN.EXE. Never write to guest memory or keep a view across WASM heap growth.
export const BOSS_HUD_LAYOUTS=Object.freeze({
  solo:{x:448,captionY:128,barY:144,width:128},
  multi:{x:448,captionY:336,barY:352,width:128},
});

// Total-bar thresholds, not per-phase replacement gauges. Stage 4 chooses its
// survivor table from the native update function (not HP/phase guesses).
export const BOSS_GAUGES=Object.freeze({
  sara:{max:4650,cuts:[2550,450]},
  louise:{max:4400,cuts:[3000,1900,500]},
  alice:{max:9600,cuts:[7400,5200,3000,800]},
  twins:{max:9000,cuts:[5500,2250]},
  mai:{max:7800,cuts:[5800,2800,1200]},
  yuki:{max:7900,cuts:[4600,3200,1200]},
  yumeko:{max:8300,cuts:[7500,6300,5700,4500,3200,2700,1200]},
  shinki:{max:22800,cuts:[20600,18400,14600,11600,8600,5600,3800,2800]},
  extra:{max:26500,cuts:[23800,21000,18100,15100,12600,9600,6800,3400]},
});

export function readBossState(source){
  if(!source)return null;
  const {heap,mailbox,patch,solo=false}=source;
  if(!heap||!patch||!Number.isInteger(mailbox)||mailbox<0)return null;
  const code=mailbox-patch.mailbox_cs_offset;
  const data=code+(patch.data_segment-patch.code_segment)*16;
  if(code<0||data<0||data+0xc698>heap.length)return null;
  const v=new DataView(heap.buffer,heap.byteOffset,heap.byteLength);
  const u8=at=>heap[data+at],i16=at=>v.getInt16(data+at,true);
  const stage=u8(0x576e);
  if(stage>6)return null;
  return {stage,solo,data,code,hp:i16(0x5ac6),phase:u8(0x5ac9),frame:i16(0x5aca),
    mode:u8(0x5acd),cycles:u8(0x5acf),endHp:i16(0x5ad0),
    hp2:i16(0x5ade),phase2:u8(0x5ae1),frame2:i16(0x5ae2),
    midHp:i16(0x5ab2),midPhase:u8(0x5ab5),midFrame:i16(0x5ab6),
    bossUpdate:v.getUint16(data+0xc672,true),midUpdate:v.getUint16(data+0xc4ae,true),
    barValue:i16(0x1a5e),state:Array.from(heap.subarray(data+0xc682,data+0xc692)),
    x:i16(0x5aba),y:i16(0x5abc),targetX:i16(0x5ad2),targetY:i16(0x5ad4)};
}

// PC-98 640x400 / 24 kHz nominal game time. This counts native updates, not
// requestAnimationFrame, network steps, host wall time or the desktop port's 56.
export const GAME_HZ=56.4;
const frames=(deadline,elapsed,estimated=false)=>({frames:Math.max(0,deadline-elapsed),estimated});

// Native attack -> movement -> next attack. The final movement exits the
// phase before starting another attack. Cycle counters must not be reset here:
// some games carry them across phases, or skip cycles at HP thresholds.
export function timeline(limit,completed,mode,elapsed,attack,move,estimated=true){
  if(completed>limit||completed<0)return null;
  let remaining=-elapsed;
  for(let n=completed;n<limit;n++){
    if(n!==completed||mode!==0)remaining+=attack(n);
    remaining+=move(n);
  }
  return frames(remaining,0,estimated);
}

// Simulate only the original integer approach rule, never the actual game.
// Yuki's future random destinations are unknown, hence her cycle timers use ~.
function towardsFrames(value,target,vertical){
  for(let n=1;n<512;n++){
    const delta=target-value;
    const step=Math.trunc(delta/16)||Math.trunc(delta/(vertical?2:4));
    if(!step)return n;
    value+=step;
  }
  return 512;
}

export function bossTimeout(s,kind){
  const {phase:p,frame:f,cycles:n,mode:m}=s;
  const t=(limit,attack,move)=>timeline(limit,n,m,f,attack,()=>move);
  switch(kind){
  case 'sara':
    if(p===4)return frames(1300,f);
    if(p===2||p===3){
      const second=p===2,limit=second?32:24;
      let wait=second?s.state[9]:16,attack=second?44:s.state[9],remaining=-f;
      if(n>limit)return null;
      for(let cycle=n;cycle<limit;cycle++){
        if(cycle!==n||m){remaining+=attack;if(second){if(wait>12)wait-=12;}else if(attack<180)attack+=24;}
        remaining+=wait+28;
      }
      return frames(remaining,0,true);
    }
    break;
  case 'louise':
    if(p===2)return t(20,k=>k%2?96:64,64);
    if(p===4)return timeline(20,n,0,f,()=>0,()=>128);
    if(p===5)return t(20,k=>k%2?64:128,48);
    if(p===7)return timeline(10,n,0,f,()=>0,()=>128);
    break;
  case 'alice':
    if([3,6,9,12].includes(p))return t(24,()=>96,36);
    if([5,8,11].includes(p))return frames(600,f);
    if(p===14)return frames(1000,f);
    break;
  case 'twins':
    if(p===2)return timeline(36,n,m,f,k=>{
      const pattern=k===0?1:k%4+1;
      return k<10?[128,160,96,128][pattern-1]:k<15?160:[128,160,256,256][pattern-1];
    },k=>k===9||k===14?112:64);
    break;
  case 'mai':
    if(p===3)return t(36,k=>k%2?192:160,60);
    if(p===5)return frames(5000,f);
    if(p===7)return t(36,k=>k%2?192:224,60);
    if(p===9)return t(20,()=>129,32);
    break;
  case 'yuki':
    if(p===3||p===5){
      const limit=p===3?12:24,attack=p===3?256:160;
      const currentMove=p===3?Math.max(towardsFrames(s.x,s.targetX,false),towardsFrames(s.y,s.targetY,true)):towardsFrames(s.y,96*16,true);
      const nextMove=towardsFrames(s.y,96*16,true);
      return timeline(limit,n,m,m?f:0,()=>attack,k=>k===n&&!m?currentMove:nextMove,true);
    }
    if(p===7)return frames(2000,f);
    if(p===9)return t(36,()=>64,8);
    break;
  case 'yumeko':
    if(p===2)return t(20,k=>k%2?80:68,64);
    if(p===5)return t(20,k=>k%2?192:256,64);
    if([4,7,8].includes(p))return frames(2000,f);
    if(p===10)return frames(1200,f);
    break;
  case 'shinki':
    if(p===2)return t(16,k=>k%2?96:60,60);
    if(p===3)return t(16,()=>92,60);
    if([6,7,9,10,12].includes(p))return frames(3000,f);
    break;
  case 'extra':
    if([2,6].includes(p))return t(32,()=>128,60);
    if(p===10)return t(32,k=>k%2?128:208,60);
    if(p===14)return t(32,k=>k%2?128:256,60);
    if([4,8,12].includes(p))return frames(4001,f);
    if(p===16)return frames((9-n)*1120,f,true);
    if(p===17)return frames(5001,f);
    break;
  }
  return null;
}

const MID_GAUGES=[{max:1000,cuts:[200]},{max:1400,cuts:[800,600,400]},
  {max:1400,cuts:[]},{max:1100,cuts:[]},{max:1550,cuts:[]},null,{max:3000,cuts:[1000]}];

function midTimeout(s){
  const p=s.midPhase,f=s.midFrame,b=s.state;
  if(s.stage===0&&p===3)return frames(1500,f);
  if(s.stage===1&&(p===1||p===2))return frames(p===1?1000:800,f);
  if(p!==1)return null;
  if(s.stage===2)return timeline(13,b[13],b[14],f,()=>160,()=>32);
  if(s.stage===3)return timeline(16,b[13],b[14],f,()=>96,()=>80);
  if(s.stage===4)return timeline(16,b[13],b[14],f,k=>k%3===2?64:96,()=>32);
  if(s.stage===6)return timeline(20,b[14],0,f,()=>0,k=>k===b[14]&&b[12]===0?112:128);
  return null;
}

export function bossHudModel(s){
  if(!s||s.barValue<=0||s.barValue>128)return null;
  let kind,gauge,timer,hp;
  if(s.bossUpdate!==0&&s.bossUpdate!==0x1930&&s.phase<253&&s.hp>0){
    kind=['sara','louise','alice','twins','yumeko','shinki','extra'][s.stage];
    if(s.stage===3){
      if(s.bossUpdate===0x3795)kind='yuki';
      else if(s.bossUpdate===0x42bb)kind='mai';
      // Only the twins use two HP values. Survivors return to the main struct.
    }
    gauge=BOSS_GAUGES[kind];hp=kind==='twins'?s.hp+s.hp2:s.hp;
    timer=bossTimeout(s,kind);
  }else if(s.midUpdate!==0&&s.midUpdate!==0x1930&&s.midPhase<254&&s.midHp>0){
    kind='midboss';gauge=MID_GAUGES[s.stage];hp=s.midHp;timer=midTimeout(s);
  }
  if(!gauge||hp>gauge.max||hp<=0)return null;
  const text=timer?(timer.estimated?'~':'')+Math.ceil(timer.frames/GAME_HZ):'';
  return {kind,hp,max:gauge.max,cuts:gauge.cuts,timer,text,
    layout:s.solo?BOSS_HUD_LAYOUTS.solo:BOSS_HUD_LAYOUTS.multi};
}

export function createBossHud(read){
  // Only two rows (16 KiB), separate from the player/score overlay.
  const canvas=new OffscreenCanvas(128,32),ctx=canvas.getContext('2d');
  const atlas=new OffscreenCanvas(208,16),ink=atlas.getContext('2d');
  const pixels=ink.createImageData(208,16);
  for(const [n,glyph]of [...hudDigits,...enemyGlyphs].entries())for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    if(!(glyph[y*2+(x>>>3)]&(128>>>(x&7))))continue;
    const at=(y*208+n*16+x)*4;
    pixels.data.set(n<10?[255,255,255,255]:[255,255,0,255],at);
  }
  ink.putImageData(pixels,0,0);
  let signature=null,revision=0,model=null;
  return ()=>{
    model=bossHudModel(readBossState(read()));
    const key=model?JSON.stringify([model.kind,model.text,model.layout.captionY]):'';
    if(key!==signature){
      signature=key;revision++;ctx.clearRect(0,0,128,32);
      if(model){
        // Relocate the three original Enemy!! gaiji to the bar's left edge.
        ctx.fillStyle='#000';ctx.fillRect(0,0,128,16);
        ctx.drawImage(atlas,160,0,48,16,0,0,48,16);
        let x=128-model.text.length*16;
        for(const c of model.text){
          if(c==='~'){
            ctx.fillStyle='#fff';for(const [dx,dy]of [[2,8],[3,7],[4,7],[5,8],[6,9],[7,9],[8,8]])ctx.fillRect(x+dx,dy,1,1);
          }else ctx.drawImage(atlas,Number(c)*16,0,16,16,x,0,16,16);
          x+=16;
        }
        for(const cut of model.cuts){
          const marker=Math.floor(cut*128/model.max);
          ctx.fillStyle='#000';ctx.fillRect(marker,19,1,10);
          ctx.fillStyle='#fff';ctx.fillRect(marker,18,1,1);ctx.fillRect(marker,29,1,1);
        }
      }
    }
    return {canvas,revision,visible:!!model,top:model?.layout.captionY??-32,model};
  };
}

// QA-only composition uses the exact same packed texture as WebGL.
export function compositeBossHudRgb(rgb,hud){
  if(!hud?.visible)return;
  const pixels=hud.canvas.getContext('2d').getImageData(0,0,128,32).data;
  for(let y=0;y<32;y++)for(let x=0;x<128;x++){
    const p=(y*128+x)*4;if(!pixels[p+3])continue;
    rgb.set(pixels.subarray(p,p+3),((y+hud.top)*640+x+448)*3);
  }
}
