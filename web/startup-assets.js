import {sha256} from './netplay/sha256.js';

// Content identity comes from the current no-store manifest. Cache only bytes
// verified against that identity, before installing any per-session settings.
let database;
function openCache(){
  return database??=new Promise(resolve=>{
    if(!globalThis.indexedDB){resolve(null);return;}
    try{
      const request=indexedDB.open('th05-startup-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('resources',{keyPath:'key'}).createIndex('identity','identity');
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
      request.onerror=request.onblocked=()=>resolve(null);
    }catch{resolve(null);}
  });
}
async function cached(key){
  try{
    const db=await openCache();if(!db)return null;
    return await new Promise(resolve=>{
      const tx=db.transaction('resources','readonly'),request=tx.objectStore('resources').get(key);
      request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>resolve(null);
      tx.onabort=()=>resolve(null);
    });
  }catch{return null;}
}
async function remember(record){
  try{
    const db=await openCache();if(!db)return;
    const tx=db.transaction('resources','readwrite'),store=tx.objectStore('resources');
    store.put(record);
    // Keep one verified version of each URL/kind rather than every past disk.
    const cursor=store.index('identity').openKeyCursor(IDBKeyRange.only(record.identity));cursor.onsuccess=()=>{
      const item=cursor.result;if(!item)return;
      if(item.primaryKey!==record.key)store.delete(item.primaryKey);
      item.continue();
    };
    tx.onerror=()=>{};
  }catch{/* Private browsing, quota and unsupported module cloning fall back. */}
}
function identity(url,kind){return kind+':'+new URL(url,import.meta.url).href.split('?')[0];}
export async function loadVerifiedBytes(url,hash,{gzip=false,size,report=()=>{}}={}){
  const name=identity(url,gzip?'disk':'bytes'),key=name+':'+hash;
  const saved=await cached(key);
  if(saved?.hash===hash&&saved.bytes instanceof Uint8Array&&(size===undefined||saved.bytes.length===size)){
    report('cache');return saved.bytes;
  }
  report('download');
  const address=new URL(url,import.meta.url);address.searchParams.set('v',hash);
  const response=await fetch(address);if(!response.ok)throw Error(`资源下载失败：${address.pathname} (${response.status})`);
  const bytes=new Uint8Array(await (gzip?new Response(response.body.pipeThrough(new DecompressionStream('gzip'))):response).arrayBuffer());
  report('verify');
  if((size!==undefined&&bytes.length!==size)||await sha256(bytes)!==hash)throw Error(`资源校验失败：${address.pathname}`);
  // IndexedDB clones synchronously on put; subsequent configuration writes to
  // this caller's disk cannot contaminate the clean cached image.
  await remember({key,identity:name,hash,bytes});
  return bytes;
}
export async function loadCompiledCore(url,hash,report=()=>{}){
  const name=identity(url,'module'),key=name+':'+hash,saved=await cached(key);
  if(saved?.hash===hash&&saved.module instanceof WebAssembly.Module){report('compiled-cache');return saved.module;}
  const bytes=await loadVerifiedBytes(url,hash,{report});report('compile');
  const module=await WebAssembly.compile(bytes);
  await remember({key,identity:name,hash,module});return module;
}
