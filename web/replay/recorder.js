import {ConfirmedTape,VERSION,encodeTape,fingerprint,randomId,stable} from './tape.js';
import {GAME,SOURCE_PATHS,PORTABLE} from './profile.js';
import {createBuilder} from './builder.js';
import {publishNetwork} from './network.js';
import {LOCAL_CHUNK,pointSize,pointIndex} from './local-points.js';
// Every public operation isolates failures from the player's execution loop.
export function createRecorder(toolbar){
  let tape=null,error='',channel=null,busy=false,exportEpoch=0,builder=null,pointError='',points=[],network=null,closed=false;
  const id=randomId(),save=document.createElement('button'),watch=document.createElement('a'),info=document.createElement('span');
  save.type='button';save.textContent='保存 Replay';save.disabled=true;
  watch.textContent='同浏览器观战';watch.target='_blank';watch.rel='noopener';watch.hidden=true;
  watch.href=new URL('../replay.html?watch='+id,import.meta.url).href;
  const open=document.createElement('a');open.textContent='打开 Replay';open.href=new URL('../replay.html',import.meta.url).href;open.target='_blank';open.rel='noopener';
  toolbar?.append(save,open,watch,info);
  const remote=document.createElement('a');remote.textContent='跨设备观战链接';remote.target='_blank';remote.rel='noopener';remote.hidden=true;toolbar?.append(remote);
  function update(){save.disabled=!tape||busy;info.textContent=error?'录像停止：'+error:tape?` · 已记录 ${tape.rows.length} 步${tape.end?'（片段结束）':''}${points.length?' · '+points.length+' 个定位点':''}${pointError?' · '+pointError:''}`:'';}
  function fail(e){error=String(e.message||e);tape?.finish('录像辅助链路失败：'+error);builder?.finish();network?.kick();update();}
  function guard(fn){try{const r=fn();update();return r;}catch(e){fail(e);}}
  function download(blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`th${GAME}-${Date.now()}.th${GAME}${tape.header.adapter==='native-local/1'?'r':'m'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function snapshot(){if(!tape)return;const value=tape.snapshot();if(points.length)value.points=points.filter(p=>p.frame<=value.rows.length);return value;}
  save.onclick=async()=>{if(!tape||busy)return;busy=true;update();const epoch=exportEpoch;try{const fixed=snapshot(),blob=await encodeTape(fixed);if(epoch===exportEpoch)download(blob);}catch(e){fail(e);}finally{busy=false;update();}};
  return {
    async boot({settings,players,hostSlot,opening,tickMs=1000/60,adapter='confirmed-worker/1'}){
      try{
        const identity=await fingerprint(SOURCE_PATHS);if(closed)return;
        tape=new ConfirmedTape({version:VERSION,game:GAME,adapter,settings:structuredClone(settings),players,hostSlot,tickMs,identity,opening});
        if(PORTABLE)builder=createBuilder(tape.header,()=>tape.rows,p=>{points.push(p);update();},e=>{pointError='定位点生成停止：'+e.message;update();});
        channel=new BroadcastChannel('pc98-replay-'+id);let lastReply=0;
        channel.onmessage=({data})=>guard(()=>{
          if(data?.type==='pull-point'){
            if(typeof data.viewer!=='string'||data.viewer.length>100||!Number.isInteger(data.frame)||!Number.isInteger(data.offset)||data.offset<0||data.offset%LOCAL_CHUNK)return;
            const p=points.find(p=>p.frame===data.frame);if(!p||data.offset>=pointSize(p))return;
            const start=data.offset/3*4;channel.postMessage({type:'point',viewer:data.viewer,frame:p.frame,sha:p.sha,size:pointSize(p),offset:data.offset,payload:p.data.slice(start,start+LOCAL_CHUNK/3*4)});return;
          }
          if(data?.type!=='pull'||typeof data.viewer!=='string'||data.viewer.length>100||!Number.isInteger(data.first)||data.first<0||data.first>tape.rows.length)return;
          // Bounded replies; a slow viewer never holds the player at a barrier.
          const now=performance.now();if(now-lastReply<10)return;lastReply=now;
          channel.postMessage({type:'slice',viewer:data.viewer,header:tape.header,first:data.first,rows:tape.rows.slice(data.first,data.first+60),available:tape.rows.length,end:tape.end,points:pointIndex(points),pointsDone:!!tape.end&&(!builder||builder.done)});
        });watch.hidden=false;update();
      }catch(e){fail(e);}
    },
    stage:(frame,row)=>guard(()=>{if(!tape)return;if(frame<tape.rows.length){if(stable(row)!==stable(tape.rows[frame]))throw Error('已确认录像在分组回滚时改变');return;}tape.stage(frame,row);}),
    rewind:frame=>guard(()=>tape?.rewind(Math.max(frame,tape.rows.length))),
    confirm:(prefix,dirty)=>guard(()=>{tape?.confirm(prefix,dirty);builder?.kick();network?.kick();}),
    finish:reason=>guard(()=>{tape?.finish(reason);builder?.finish();network?.kick();}),
    connectNetwork(identity){guard(()=>{if(!tape||network||closed)return;network=publishNetwork(tape.header,()=>tape.rows,()=>tape.end,identity,{getPoints:()=>({points,done:!builder||builder.done}),onLink:url=>{remote.href=url;remote.hidden=false;},onStatus:text=>{remote.title=text;}});});},
    snapshot,
    get error(){return error;},
    close(){closed=true;exportEpoch++;tape?.finish('录像来源关闭');channel?.close();builder?.stop();network?.stop();}
  };
}
