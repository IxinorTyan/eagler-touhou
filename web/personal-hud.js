import {hudDigits} from './hud-digits.js';

// Only a small presentation texture changes. No local view is written into
// guest RAM, video RAM, snapshots, input packets or the network checksum.
export function createPersonalHud(read,select){
  // Pack the 128-pixel sidebar and 128-pixel settlement column. This avoids
  // uploading a full-screen RGBA texture when only a score digit changes.
  const canvas=new OffscreenCanvas(256,400),ctx=canvas.getContext('2d');
  const atlas=new OffscreenCanvas(160,16),ink=atlas.getContext('2d'),pixels=ink.createImageData(160,16);
  for(let n=0;n<10;n++)for(let y=0;y<16;y++)for(let x=0;x<16;x++)if(hudDigits[n][y*2+(x>>>3)]&(128>>>(x&7))){
    const at=(y*160+n*16+x)*4;pixels.data.fill(255,at,at+4);
  }
  ink.putImageData(pixels,0,0);
  let tram=-1,buffer=null,lastSearch=-Infinity,layout=-1,revision=0;
  let changed=false,dream=-1;
  const numbers=new Map();
  function number(n,x,y,count,zero=false){
    x=x>=448?x-448:x-272+128;
    const key=y*256+x;
    let row=numbers.get(key);
    if(!row){
      row={value:null,text:null};numbers.set(key,row);
    }
    if(row.value===n)return;
    row.value=n;
    const text=String(n).padStart(count,zero?'0':' ').slice(-count);
    if(row.text===text)return;
    // The packed canvas is retained between frames, so an unchanged field
    // needs neither digit drawing nor another intermediate canvas copy.
    row.text=text;ctx.fillStyle='#000';ctx.fillRect(x,y,count*16,16);
    for(let i=0;i<count;i++)if(text[i]!==' ')ctx.drawImage(atlas,Number(text[i])*16,0,16,16,x+i*16,y,16,16);
    changed=true;
  }
  return ()=>{
    const source=read();let values=null;
    if(source){
      const {heap,mailbox,patch}=source,view=new DataView(heap.buffer),schema=patch.personal_stats;
      if(buffer!==heap.buffer){buffer=heap.buffer;tram=-1;lastSearch=-Infinity;}
      if(tram<0&&performance.now()-lastSearch>1000){lastSearch=performance.now();tram=findDosboxTram(heap);}
      const cell=tram<0?0:view.getUint16(tram+6*160+56*2,true),slot=select();
      if(schema&&Number.isInteger(slot)&&slot>=0&&slot<heap[mailbox-patch.mailbox_cs_offset+patch.entry_map.player_count]&&
         (cell&255)===0x57&&(cell>>>8)>=0x20&&(cell>>>8)<=0x29){
        const code=mailbox-patch.mailbox_cs_offset,at=code+schema.cs_offset+slot*schema.stride;
        const d=code+(patch.data_segment-patch.code_segment)*16,bonus=code+schema.bonus_cs_offset;
        const mode=heap[bonus],stageTitle=view.getUint16(tram+4*160+20*2,true)===0x4d56,
          clearTitle=view.getUint16(tram+4*160+19*2,true)===0x5c56;
        const settlement=(mode===1&&stageTitle)||(mode===2&&clearTitle)?mode:0;
        values={score:view.getUint32(at,true),high:view.getUint32(at+4,true),point:view.getUint16(at+8,true),
          total:view.getUint16(at+10,true),dream:heap[at+12],graze:view.getUint16(at+14,true),settlement,
          bonus:view.getUint32(bonus+1+slot*4,true),stage:heap[d+0x576e],
          lives:heap[mailbox+patch.mailbox_offsets.stats+slot*4],
          misses:view.getUint16(at+24,true),bombs:view.getUint16(at+26,true),
          stageMiss:view.getUint16(at+28,true),stageBomb:view.getUint16(at+30,true)};
      }
    }
    const nextLayout=values?values.settlement:-1,reset=nextLayout!==layout;
    changed=reset;
    if(reset){layout=nextLayout;ctx.clearRect(0,0,256,400);numbers.clear();dream=-1;}
    if(values){
      number(values.high,448,64,8,true);number(values.score,448,96,8,true);
      number(values.total,496,240,5);number(values.point,496,256,5);number(values.graze,496,288,5);
      // TH05's dream meter lives on row 20. Its native P1 value is replaced
      // only in this final image; each seat retains the native 1..128 range.
      if(dream!==values.dream){
        dream=values.dream;
        ctx.fillStyle='#000';ctx.fillRect(0,320,128,16);
        ctx.fillStyle='#f5cf75';ctx.fillRect(0,326,Math.min(128,dream),4);
        changed=true;
      }
      if(values.settlement){
        const all=values.settlement===2;
        number(all?10000:(values.stage+1)*1000,272,all?96:128,8);
        number(values.dream*100,272,all?128:160,8);
        number(values.graze*50,272,all?160:192,8);
        if(all)number(Math.max(0,values.lives-1)*10000,272,192,8);
        number(values.point,320,224,5);
        if(all)number(values.total*2500,272,288,8);
        const noMiss=all?values.misses===0:values.misses===values.stageMiss;
        const noBomb=noMiss&&(all?values.bombs===0:values.bombs===values.stageBomb);
        const reward=all?500000:values.stage*50000+100000;
        number(noMiss?reward:0,272,256,8);number(noBomb?reward:0,272,272,8);
        number(values.bonus,272,336,8);
      }
    }
    if(changed)revision++;
    return {canvas,revision,visible:!!values,slot:select()};
  };
}

// QA-only expected-image composition, matching the packed GPU texture.
export function compositePersonalHudRgb(rgb,hud){
  if(!hud?.visible)return;
  const pixels=hud.canvas.getContext('2d').getImageData(0,0,256,400).data;
  for(let y=0;y<400;y++)for(let x=0;x<256;x++){
    const p=(y*256+x)*4;if(!pixels[p+3])continue;
    const target=(y*640+(x<128?x+448:x-128+272))*3;
    rgb.set(pixels.subarray(p,p+3),target);
  }
}

export function findDosboxTram(heap){
  const view=new DataView(heap.buffer,heap.byteOffset,heap.byteLength),score=6*160+56*2,high=4*160+56*2;
  function row(at){
    if(at<2||at+34>heap.length||view.getUint16(at-2,true)!==0x20||view.getUint16(at+32,true)!==0x20)return false;
    for(let i=0;i<8;i++){
      const word=view.getUint16(at+i*4,true);
      if((word&255)!==0x57||(word>>>8)<0x20||(word>>>8)>0x29||view.getUint16(at+i*4+2,true)!==(word|0x8000))return false;
    }
    return true;
  }
  for(let at=heap.indexOf(0x57,score);at>=0;at=heap.indexOf(0x57,at+1))if(!(at&1)&&row(at)&&row(at-score+high))return at-score;
  return -1;
}
