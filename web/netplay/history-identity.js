import {sha256} from './sha256.js';
// Presentation-only assets are not part of the simulation identity. Both core
// variants are included, allowing the existing tracked/fallback pairing.
const sources=['lan-worker.js','netplay/protocol.js','netplay/rollback-queue.js','netplay/history-proof.js',
  'netplay/confirmed-history.js','launch-config.js','disk-files.js','game-locator.js','native-players.js','native-touch.js',
  'touch-input.js','music-files.js','solo-native-music.js','dosbox-snapshots.js','dosbox-memory-diff.js',
  'netplay/stage-initial.js','netplay/stage-stream.js','netplay/stage-history.js','portable-checkpoint.js','netplay/checkpoint-archive.js'];
export async function historyIdentity(manifest,patch,musicPatch){
  const hashes=await Promise.all(sources.map(async name=>{
    const response=await fetch(new URL('../'+name,import.meta.url),{cache:'no-store'});
    if(!response.ok)throw Error('多人帧历史适配器读取失败');
    return [name,await sha256(new Uint8Array(await response.arrayBuffer()))];
  }));
  return sha256(new TextEncoder().encode(JSON.stringify({version:1,manifest,patch,musicPatch,hashes})));
}
