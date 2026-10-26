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
  if(!api.thArtBind||(Number.isInteger(patch.body_layer_cs_offset)&&!api.thLayerSetView))throw Error('自机美术显示核心版本不匹配');
  const control=api.malloc(32),table=api.malloc(bytes.length),tags=api.malloc(1048576);
  const records=api.malloc(3*524288*4),coverage=api.malloc(524288);
  if(!control||!table||!tags||!records||!coverage)throw Error('自机美术显示内存不足');
  mod.HEAPU8.set(bytes,table);mod.HEAPU8.fill(0,tags,tags+1048576);
  mod.HEAPU8.fill(0,control,control+32);mod.HEAPU8.fill(0,coverage,coverage+524288);
  const v=new DataView(mod.HEAPU8.buffer);v.setUint32(control+4,table,true);v.setUint32(control+8,tags,true);
  v.setUint32(control+16,records,true);v.setUint32(control+20,coverage,true);
  api.thArtBind(control);
  return {control,table,tags,view:slot=>api.thLayerSetView?.(Number.isInteger(slot)&&slot>=0&&slot<3?slot:-1),bind(mailbox){
    mod.thDirtyMark?.(control,32);
    const view=new DataView(mod.HEAPU8.buffer);
    view.setUint32(control,mailbox<0?0:mailbox-patch.mailbox_cs_offset+patch.entry_map.afterimage_context,true);
    view.setUint32(control+12,mailbox<0?0:mailbox+25,true);
    view.setUint32(control+24,mailbox<0||!Number.isInteger(patch.body_layer_cs_offset)?0:mailbox-patch.mailbox_cs_offset+patch.body_layer_cs_offset,true);
  }};
}
