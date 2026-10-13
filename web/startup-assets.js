import {sha256} from './sha256.js';

// Keep pristine, verified bytes separate from mutable game/save disks.
let database;
async function cache(mode, key, value) {
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('th03-startup-assets', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('bytes');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('资源缓存被占用'));
  });
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bytes', mode), store = tx.objectStore('bytes');
    const request = mode === 'readonly' ? store.get(key) : store.put(value, key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || request.error);
  });
}

export async function loadVerifiedBytes(url, expected, {gzip = false} = {}) {
  const key = `${gzip ? 'disk' : 'asset'}:${new URL(url, location.href).href}:${expected}`;
  try {
    const saved = await cache('readonly', key);
    if (saved) {
      const bytes = new Uint8Array(saved);
      if (await sha256(bytes) === expected) return bytes;
    }
  } catch {} // Storage restrictions must never prevent a fresh download.
  const response = await fetch(url, {cache: 'no-cache'});
  if (!response.ok) throw Error(`资源加载失败 (${response.status})：${url}`);
  const body = gzip ? new Response(response.body.pipeThrough(new DecompressionStream('gzip'))) : response;
  const bytes = new Uint8Array(await body.arrayBuffer());
  if (await sha256(bytes) !== expected) throw Error(`资源校验失败：${url}`);
  // IndexedDB clones on put; callers may patch their returned disk freely.
  try { await cache('readwrite', key, bytes); } catch {}
  return bytes;
}

export async function loadNetworkAssets(runtime, progress = () => {}) {
  const files = Object.entries(runtime.files);
  let next = 0, completed = 0, wasmBinary;
  await Promise.all(Array.from({length: Math.min(4, files.length)}, async () => {
    while (next < files.length) {
      const [path, hash] = files[next++];
      const bytes = await loadVerifiedBytes(path, hash);
      if (path === 'vendor/dosbox-x/wdosbox-x-rollback.wasm') wasmBinary = bytes;
      progress(`正在校验联机资源：${++completed}/${files.length}`);
    }
  }));
  if (!wasmBinary) throw Error('同步引擎清单缺少联机内核');
  return wasmBinary;
}
