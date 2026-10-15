export function encodeConfig(config) {
  const integer=(value,min,max)=>{
    const n=Number(value);
    if(!Number.isInteger(n)||n<min||n>max)throw Error('无效的房间配置');
    return n;
  };
  if(![2,3].includes(config.players.length)||config.players.some(p=>p.spares!==config.players[0].spares||p.bombs!==config.players[0].bombs))
    throw Error('初始残机和 Bomb 必须使用全队共同设置');
  const players=config.players.slice();
  if(players.length===2)players.push({character:2,spares:config.players[0].spares,bombs:config.players[0].bombs});
  return Uint8Array.from([1,integer(config.rank,0,4),...players.flatMap(p=>[
    integer(p.character,0,3),integer(p.spares,0,5)+1,integer(p.bombs,0,3)]),config.players.length]);
}
export function installConfig(disk,manifest,config) {
  const bytes=encodeConfig(config),layout=manifest.launch_config;
  if(!layout||layout.targets.length!==2)throw Error('启动配置版本不匹配');
  for(const offsets of layout.targets){
    if(offsets.length!==bytes.length||offsets.some((at,i)=>!Number.isInteger(at)||at<0||at>=disk.length||disk[at]!==layout.defaults[i]))
      throw Error('启动配置位置校验失败');
  }
  for(const offsets of layout.targets)offsets.forEach((at,i)=>disk[at]=bytes[i]);
}
