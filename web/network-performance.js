// Bounded local history: no pixel readback, uploads, room tokens or addresses.
export function createNetworkHistory(limit=600){
  const samples=[];
  return {push(sample){samples.push(structuredClone(sample));if(samples.length>limit)samples.splice(0,samples.length-limit);},read(){return structuredClone(samples);}};
}
export function mountNetworkPerformance({host,toolbar,getReport}){
  const save=()=>{
    const report=getReport(),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`th03-network-${report.seat??'waiting'}-${Date.now()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  };
  for(const target of [host.querySelector('.player-toolbar'),toolbar].filter(Boolean)){
    const button=document.createElement('button');button.type='button';button.textContent='日志';button.title='下载最近 10 分钟的联机运行日志';button.dataset.networkReport='';button.onclick=save;target.append(button);
  }
}
