// Native body, projectile, hit and HUD blits label their VRAM writes. Scanout
// applies reviewed RGB only to those pixels; native writes clear provenance.
import {loadVerifiedBytes} from './startup-assets.js';
export async function loadAfterimageArt(patch){
  const info=patch.afterimageArt;
  if(!info)return null;
  return loadVerifiedBytes(new URL(info.file,import.meta.url),info.sha256,{size:info.bytes});
}
export async function installAfterimageArt(mod,patch,bytes){
  bytes??=await loadAfterimageArt(patch);
  if(!bytes)return null;
  const api=mod.nativeExports();
  if(!api.thArtBind)throw Error('自机美术显示核心版本不匹配');
  const control=api.malloc(16),table=api.malloc(bytes.length),tags=api.malloc(1048576);
  if(!control||!table||!tags)throw Error('自机美术显示内存不足');
  mod.HEAPU8.set(bytes,table);mod.HEAPU8.fill(0,tags,tags+1048576);
  mod.HEAPU8.fill(0,control,control+16);
  const v=new DataView(mod.HEAPU8.buffer);v.setUint32(control+4,table,true);v.setUint32(control+8,tags,true);
  api.thArtBind(control);
  return {control,table,tags,bind(mailbox){
    mod.thDirtyMark?.(control,16);
    const view=new DataView(mod.HEAPU8.buffer);
    view.setUint32(control,mailbox<0?0:mailbox-patch.mailbox_cs_offset+patch.entry_map.afterimage_context,true);
    view.setUint32(control+12,mailbox<0?0:mailbox+25,true);
  }};
}
