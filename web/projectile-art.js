export async function installProjectileArt(mod,patch){
  const info=patch?.projectileArt;if(!info)return null;
  const response=await fetch(new URL(info.file,import.meta.url));
  if(!response.ok)throw Error('射弹美术资源加载失败');
  const bytes=new Uint8Array(await response.arrayBuffer());
  const {sha256}=await import('./netplay/sha256.js');
  if(bytes.length!==info.bytes||await sha256(bytes)!==info.sha256)throw Error('射弹美术资源版本不匹配');
  const api=mod.nativeExports();if(!api.thArtBind)throw Error('射弹显示核心版本不匹配');
  const control=api.malloc(16),table=api.malloc(bytes.length),tags=api.malloc(1048576);
  if(!control||!table||!tags)throw Error('射弹显示内存不足');
  mod.HEAPU8.set(bytes,table);mod.HEAPU8.fill(0,tags,tags+1048576);mod.HEAPU8.fill(0,control,control+16);
  let v=new DataView(mod.HEAPU8.buffer);v.setUint32(control+4,table,true);v.setUint32(control+8,tags,true);api.thArtBind(control);
  return {control,table,tags,bind(mailbox){
    mod.thDirtyMark?.(control,16);v=new DataView(mod.HEAPU8.buffer);
    v.setUint32(control,mailbox<0?0:mailbox-patch.mailbox_cs_offset+info.context_cs_offset,true);
    v.setUint32(control+12,mailbox<0?0:mailbox+25,true);
  }};
}
