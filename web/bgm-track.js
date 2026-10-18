import {bgmVersion} from './bgm-version.js';
let alternate;
async function json(path){const r=await fetch(new URL(path,import.meta.url));if(!r.ok)throw Error('音乐清单读取失败');return r.json();}
export async function loadMusicTrack(context,key){
  const version=bgmVersion();
  let track;
  if(version==='new'){
    if(!alternate){alternate=json('./bgm/akyu/manifest.json');alternate.catch(()=>{alternate=null;});}
    track=(await alternate).tracks[key];
  }
  track??=await json(`./bgm/${key}.json`);
  const response=await fetch(new URL('./bgm/'+track.url,import.meta.url));
  if(!response.ok)throw Error('音乐资源读取失败');
  const buffer=await context.decodeAudioData(await response.arrayBuffer());
  return [buffer,{loopStart:track.loopStart,loopEnd:track.fullLoop?buffer.duration:track.loopEnd}];
}
