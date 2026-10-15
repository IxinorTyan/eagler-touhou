// Connection facilities only. No frame/input/snapshot or membership policy here.
// A hosting application may set th05NetplayUdp before starting a room.
// th05NetplayConnection remains accepted as a compatibility alias.
export const UDP_HOLE_PUNCH_API='th05-udp-hole-punch/1';
export async function loadRtcConfiguration(session,source=globalThis.th05NetplayUdp??globalThis.th05NetplayConnection){
  if(source===undefined)return {iceServers:[],iceTransportPolicy:'all'};
  const controller=new AbortController();
  let timer;
  try{
    const config=await Promise.race([
      Promise.resolve().then(()=>typeof source==='function'?source({...session},controller.signal):source),
      new Promise((_,reject)=>{timer=setTimeout(()=>{
        reject(Error('获取连接配置超过 10 秒，请检查配置服务'));
        controller.abort();
      },10000);})
    ]);
    if(!config||typeof config!=='object'||Array.isArray(config))throw Error('连接配置必须是对象');
    if(Object.keys(config).some(key=>!['iceServers','iceTransportPolicy'].includes(key)))throw Error('连接配置仅支持 iceServers 和 iceTransportPolicy');
    const policy=config.iceTransportPolicy??'all';
    if(!['all','relay'].includes(policy))throw Error('无效 ICE 传输策略');
    const servers=config.iceServers??[];
    if(!Array.isArray(servers))throw Error('iceServers 必须是数组');
    const iceServers=servers.map(server=>{
      if(!server||typeof server!=='object')throw Error('无效 ICE 服务配置');
      const urls=Array.isArray(server.urls)?server.urls.slice():[server.urls];
      if(!urls.length||urls.some(url=>typeof url!=='string'||! /^(stun|stuns|turn|turns):\S+$/i.test(url)))throw Error('ICE 服务地址必须使用 STUN 或 TURN 协议');
      const value={urls};
      for(const key of ['username','credential'])if(server[key]!==undefined){
        if(typeof server[key]!=='string')throw Error('ICE 凭据必须是字符串');
        value[key]=server[key];
      }
      return value;
    });
    if(policy==='relay'&&!iceServers.some(server=>server.urls.some(url=>/^turns?:/i.test(url))))throw Error('强制中继需要配置 TURN 服务');
    return {iceServers,iceTransportPolicy:policy};
  }finally{clearTimeout(timer);}
}

