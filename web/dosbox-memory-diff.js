export async function makeMemoryDiff(module){
  // A portable full-copy fallback retains rollback on engines without multiple
  // memories. The fast helper changes storage only, never emulated execution.
  try{
    const response=await fetch(new URL('./vendor/dosbox-x/snapshot-diff.wasm',import.meta.url));
    if(!response.ok)throw Error('snapshot diff missing');
    const {instance}=await WebAssembly.instantiate(await response.arrayBuffer(),{env:{memory:module.nativeExports().memory}});
    const api=instance.exports,pageBytes=4096,directoryBytes=262144;let size=0;
    function reserve(){const needed=module.HEAPU8.length+directoryBytes;
      if(api.shadow.buffer.byteLength<needed)api.shadow.grow(Math.ceil((needed-api.shadow.buffer.byteLength)/65536));
    }
    return {begin(){reserve();if(!size)api.init(module.HEAPU8.length);else if(size!==module.HEAPU8.length)api.extend(size,module.HEAPU8.length);size=module.HEAPU8.length;},
      changes(){const count=api.scan(module.HEAPU8.length>>>12);return new Uint32Array(api.shadow.buffer,0,count).slice();},
      old(page){return new Uint8Array(api.shadow.buffer,directoryBytes+(page<<12),pageBytes).slice();},
      sync(page){api.copyPage(page);},
      restore(page,bytes){module.HEAPU8.set(bytes,page<<12);new Uint8Array(api.shadow.buffer,directoryBytes+(page<<12),pageBytes).set(bytes);},
      pageBytes,get bytes(){return api.shadow.buffer.byteLength;}};
  }catch{return null;}
}
