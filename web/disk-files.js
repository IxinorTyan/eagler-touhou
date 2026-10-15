// Extract the already verified, configured HDI into DOSBox-X's virtual filesystem.
// Internal DOS runs the real game executables without the disk's VEM486 pager.
export function gameFiles(bytes,{solo=false}={}) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=p=>v.getUint16(p,true),u32=p=>v.getUint32(p,true);
  const header=u32(8),sector=u32(16),spt=u32(20),heads=u32(24),part=header+sector;
  const base=header+((u16(part+10)*heads+bytes[part+9])*spt+bytes[part+8])*sector;
  const bps=u16(base+11),clusterSize=bps*bytes[base+13],fat=base+u16(base+14)*bps;
  const root=fat+u16(base+22)*bps*bytes[base+16],rootSize=u16(base+17)*32;
  const clusters=root+Math.ceil(rootSize/bps)*bps,count=Math.floor((base+(u16(base+19)||u32(base+32))*bps-clusters)/clusterSize);
  if(!clusterSize||count>4084||clusters>bytes.length)throw Error('不支持的实验磁盘格式');
  const chain=first=>{const out=[],seen=new Set();let c=first;while(c>=2&&c<0xff8){if(c>=count+2||seen.has(c))throw Error('磁盘文件簇链损坏');seen.add(c);out.push(c);const n=u16(fat+Math.floor(c*3/2));c=c&1?n>>4:n&0xfff;}return out;};
  const offset=c=>clusters+(c-2)*clusterSize,decode=new TextDecoder('shift_jis'),files=[];
  function walk(blocks,parent){for(const [start,size]of blocks)for(let at=start;at<start+size;at+=32){
    if(bytes[at]===0)return;if(bytes[at]===0xe5||(bytes[at+11]&8)||bytes[at+11]===15)continue;
    const stem=decode.decode(bytes.subarray(at,at+8)).trim(),ext=decode.decode(bytes.subarray(at+8,at+11)).trim();if(stem==='.'||stem==='..')continue;
    const path=parent+stem+(ext?'.'+ext:''),parts=chain(u16(at+26));
    if(bytes[at+11]&16)walk(parts.map(c=>[offset(c),clusterSize]),path+'/');
    else if(path==='COOP.COM'||path.startsWith('KAIKI/')){
      const size=u32(at+28),contents=new Uint8Array(size);let dest=0;
      for(const c of parts){const n=Math.min(clusterSize,size-dest);if(n<=0)break;contents.set(bytes.subarray(offset(c),offset(c)+n),dest);dest+=n;}
      if(dest!==size)throw Error('磁盘文件长度不匹配');files.push({path:'game/'+path,contents});
    }
  }}
  walk([[root,rootSize]],'');
  if(!files.some(f=>f.path==='game/KAIKI/MAIN.EXE')||
    (solo?!files.some(f=>f.path==='game/KAIKI/OP.EXE'):!files.some(f=>f.path==='game/COOP.COM')))throw Error('游戏文件缺失');
  // Normalize the original batch's CRCRLF and use an ASCII launcher. The same
  // ZUN utilities, PMD driver, resident COOP program and MAIN execute in order.
  const batch=new TextEncoder().encode('@echo off\r\nzun -g\r\nzun -m\r\nzun -s\r\nif errorlevel 1 goto fin\r\nzun -i\r\nzun -o\r\npmd86 /M8 /V0 /E2 /K /N- /P\r\nA:\\COOP.COM\r\nif errorlevel 1 goto fin\r\nmain\r\npmd86 /R\r\n:fin\r\nzun -i -r\r\nzun -s -r\r\n');
  // The original OP owns its intro, title/menu and MAIN/MAINE transition.
  // No cooperative hook or launch config is installed. The solo disk has only
  // single-player input/status hooks, equivalent to TH04's original solo mode.
  const soloBatch=new TextEncoder().encode('@echo off\r\nzun -g\r\nzun -m\r\nzun -s\r\nif errorlevel 1 goto fin\r\nzun -i\r\nzun -o\r\npmd86 /M8 /V0 /E2 /K /N- /P\r\nop\r\npmd86 /R\r\n:fin\r\nzun -i -r\r\nzun -s -r\r\n');
  files.push({path:'game/KAIKI/FAST.BAT',contents:solo?soloBatch:batch});return files;
}
