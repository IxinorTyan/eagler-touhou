import {loadVerifiedBytes} from './startup-assets.js';
export async function loadMusicAssets({effects=false}={}){
  const stem=effects?'lan-music':'music';
  const response=await fetch(new URL(stem+'-patch.json',import.meta.url),{cache:'no-store'});
  if(!response.ok)throw Error('音乐桥接清单读取失败');
  const patch=await response.json(),bytes=await loadVerifiedBytes(new URL(stem+'.com',import.meta.url),patch.sha256);
  if(effects&&!patch.separate_effects)throw Error('请更新联机音效桥并刷新页面');
  return {patch,bytes};
}
export async function installMusicFiles(files,{solo=false,assets}={}){
  const {patch,bytes}=assets||await loadMusicAssets();
  const launcher=files.find(f=>f.path==='game/KAIKI/FAST.BAT');
  let text=new TextDecoder().decode(launcher.contents);
  const program=solo?'op':'main',anchor=`\r\n${program}\r\n`;
  if(text.split(anchor).length!==2)throw Error('音乐启动脚本不匹配');
  text=text.replace(anchor,`\r\nMUSIC.COM\r\nif errorlevel 1 goto fin\r\n${program}\r\nMUSIC.COM /R\r\n`);
  launcher.contents=new TextEncoder().encode(text);
  files.push({path:'game/KAIKI/MUSIC.COM',contents:bytes});
  return patch;
}
