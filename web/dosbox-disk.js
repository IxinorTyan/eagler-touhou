import {Fat12} from './solo-fat12.js';

// Internal DOS runs only the existing patched game files. The HDI DOS, BIOS
// startup scripts and memory managers are not executed.
export function extractGame(disk){
  const fat=new Fat12(disk),files=[],decode=new TextDecoder('shift_jis');
  function walk(ranges,parent=''){
    for(const [start,size] of ranges)for(let at=start;at<start+size;at+=32){
      const first=disk[at],attr=disk[at+11];
      if(!first)break;
      if(first===0xe5||(attr&8)||attr===15)continue;
      const stem=decode.decode(disk.subarray(at,at+8)).trim(),ext=decode.decode(disk.subarray(at+8,at+11)).trim();
      if(stem==='.'||stem==='..')continue;
      const name=parent+stem+(ext?'.'+ext:'');
      if(attr&16){
        if(name==='REIIDEN'||name.startsWith('REIIDEN/'))walk(fat.chain(fat.view.getUint16(at+26,true)).map(c=>[fat.offset(c),fat.clusterSize]),name+'/');
      }else if(name.startsWith('REIIDEN/'))files.push({path:'game/'+name,contents:fat.view.getUint32(at+28,true)?fat.read(at):new Uint8Array()});
    }
  }
  walk([[fat.root,fat.rootSize]]);
  for(const name of ['REIIDEN.EXE','GAME.BAT','REIIDEN.CFG','ORBS.CFG']){
    if(!files.some(f=>f.path==='game/REIIDEN/'+name))throw Error('灵异传磁盘缺少 '+name);
  }
  return {files};
}

export const NETWORK_CYCLES=30000;
export function dosboxConfig({network=false,cycles=NETWORK_CYCLES}={}){
  return `[dosbox]\nmachine=pc98\nmemsize=16\n[cpu]\ncore=simple\ncputype=386\ncycles=${network?cycles:'max 100%'}\n[render]\nframeskip=0\nscaler=none\naspect=false\n[sblaster]\nsbtype=none\n[pc98]\npc-98 fm board=board86\n[mixer]\nrate=44100\nblocksize=512\nprebuffer=20\n[autoexec]\n@echo off\nmount a /home/web_user/game\na:\npath a:\\REIIDEN;a:\\\ncd REIIDEN\nGAME.BAT\n`;
}
