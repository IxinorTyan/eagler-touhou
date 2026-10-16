// Exact RGB garment/ghost colors; pixel provenance and scanout live inside the
// emulator, so overlap, raster scroll, text and rollback retain native order.
import {sha256} from './solo-fat12.js';
const signature=new TextEncoder().encode('TH02COOPv0002!!\0');
export async function loadPlayerArt(patch){
  const entry=patch.playerArt;
  if(entry?.bodySource!=='ghost-preview/th02-player-colors'||!entry.originalGenjiiPreserved)throw Error('TH02 专用绿色玄爷素材清单不匹配');
  const response=await fetch(new URL(entry.file,import.meta.url),{cache:'no-store'});
  if(!response.ok)throw Error('TH02 多人配色素材读取失败');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==entry.bytes||await sha256(bytes)!==entry.sha256)throw Error('TH02 多人配色素材校验失败，请刷新游戏');
  return bytes;
}
export function installPlayerArt(mod,patch,bytes){
  const api=mod.nativeExports();
  if(!api.thArtBind||!api.thArtState)throw Error('TH02 多人配色核心版本不匹配');
  const control=api.malloc(16),table=api.malloc(bytes.length),tags=api.malloc(2*262144*2);
  if(!control||!table||!tags)throw Error('TH02 多人配色内存分配失败');
  mod.HEAPU8.set(bytes,table);mod.HEAPU8.fill(0,tags,tags+1048576);
  const view=()=>new DataView(mod.HEAPU8.buffer);
  view().setUint32(control,0,true);view().setUint32(control+4,table,true);
  view().setUint32(control+8,tags,true);view().setUint32(control+12,0,true);
  api.thArtBind(control);
  let mailbox=-1,checks=0;
  const valid=at=>at>=0&&signature.every((value,i)=>mod.HEAPU8[at+i]===value);
  function bind(){
    if(valid(mailbox))return;
    if(checks++%8)return;
    const base=api.thCoreState?api.thCoreState(0):0;
    const ram=api.thCoreState?mod.HEAPU8.subarray(base,base+0xa0000):mod.HEAPU8;
    for(let at=ram.indexOf(signature[0]);at>=0;at=ram.indexOf(signature[0],at+1)){
      if(!valid(base+at)||mod.HEAPU8[base+at+22]!==1)continue;
      mailbox=base+at;
      mod.thDirtyMark?.(control,16);
      view().setUint32(control,mailbox-patch.entries.mailbox+patch.entries.art_context,true);
      view().setUint32(control+12,mailbox+22,true);
      break;
    }
  }
  return {bind,info:()=>({enabled:true,bound:valid(mailbox),source:patch.playerArt.bodySource,
    variants:patch.playerArt.variants,originalGenjiiPreserved:true}),control,table,tags};
}
