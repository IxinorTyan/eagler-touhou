export async function makeMemoryDiff(module){
  // A portable full-copy fallback retains rollback on engines without multiple
  // memories. The fast helper changes storage only, never emulated execution.
  try{
    const tracked=!!module.thDirty;
    const response=await fetch(new URL(tracked?'./vendor/dosbox-x/snapshot-diff-tracked.wasm':'./vendor/dosbox-x/snapshot-diff.wasm',import.meta.url));
    if(!response.ok)throw Error('snapshot diff missing');
    const {instance}=await WebAssembly.instantiate(await response.arrayBuffer(),{env:{memory:module.nativeExports().memory,...(tracked?{thDirty:module.thDirty}:{})}});
    const api=instance.exports,pageBytes=4096,directoryBytes=262144,pool=[];let size=0;
    if(!api.packPages||!api.restorePages)throw Error('snapshot helper version mismatch');
    function reserve(scratchBytes=0){const needed=module.HEAPU8.length+directoryBytes+scratchBytes;
      if(api.shadow.buffer.byteLength<needed)api.shadow.grow(Math.ceil((needed-api.shadow.buffer.byteLength)/65536));
    }
    return {begin(){reserve();if(!size)api.init(module.HEAPU8.length);else if(size!==module.HEAPU8.length)api.extend(size,module.HEAPU8.length);size=module.HEAPU8.length;},
      changes(){if(tracked){const dirty=new Uint8Array(module.thDirty.buffer);for(const page of module.thDirtyStatic)dirty[page]=1;}const count=api.scan(module.HEAPU8.length>>>12);return new Uint32Array(api.shadow.buffer,0,count).slice();},
      pack(pages){
        if(!pages.length)return null;
        const length=pages.length*pageBytes,scratch=directoryBytes+module.HEAPU8.length;
        reserve(length);
        let index=pool.findIndex(buffer=>buffer.length>=length);
        const buffer=index<0?new Uint8Array(Math.ceil(length/65536)*65536):pool.splice(index,1)[0];
        api.packPages(pages.length,scratch);
        const bytes=buffer.subarray(0,length);bytes.set(new Uint8Array(api.shadow.buffer,scratch,length));
        return {pages,bytes,buffer};
      },
      restoreBlock(block){
        const scratch=directoryBytes+module.HEAPU8.length;reserve(block.bytes.length);
        new Uint32Array(api.shadow.buffer,0,block.pages.length).set(block.pages);
        new Uint8Array(api.shadow.buffer,scratch,block.bytes.length).set(block.bytes);
        api.restorePages(block.pages.length,scratch);
      },
      // Keep one largest spare. A queue of smaller retired buffers otherwise
      // survives indefinitely while a larger checkpoint is being recycled.
      release(block){if(!pool.length)pool.push(block.buffer);else if(block.buffer.length>pool[0].length)pool[0]=block.buffer;},
      old(page){return new Uint8Array(api.shadow.buffer,directoryBytes+(page<<12),pageBytes).slice();},
      sync(page){api.copyPage(page);},
      restore(page,bytes){module.HEAPU8.set(bytes,page<<12);new Uint8Array(api.shadow.buffer,directoryBytes+(page<<12),pageBytes).set(bytes);},
      pageBytes,get bytes(){return api.shadow.buffer.byteLength+pool.reduce((n,buffer)=>n+buffer.length,0);}};
  }catch{return null;}
}
