import {validateStageEvents,STAGE_MAX_BYTES} from './stage-stream.js';
import {encodeConfig} from '../launch-config.js';
// Optional browser sidecar. Full confirmed sync history remains independently
// available. Retire old/oversized stage data instead of blocking a player.
export class StageHistory {
 constructor(header,{stageBytes=STAGE_MAX_BYTES,totalBytes=4*STAGE_MAX_BYTES}={}){
  this.header=header;this.stageBytes=stageBytes;this.totalBytes=totalBytes;
  this.records=new Map();this.segments=[];this.current=null;this.bytes=0;this.error=null;
 }
 clear(){this.records.clear();this.segments=[];this.current=null;this.bytes=0;}
 append(first,count,frames){
  if(this.error)return;
  if(frames===undefined){this.current=null;return;}
  try{
   if(!Array.isArray(frames)||frames.length!==count)throw Error('分面历史帧数不符');
   const copied=structuredClone(frames),config=encodeConfig(this.header.config);
   for(const events of copied)if(events!==null){
    validateStageEvents(events,this.header.players);
    for(const e of events)if(e[0]===2&&(e[1].diskSha!==this.header.diskSha||e[1].config.some((v,i)=>v!==config[i])))throw Error('分面历史资源不符');
   }
   for(let n=0;n<count;n++){
    const frame=first+n,events=copied[n];
    if(events===null){this.current=null;continue;}
    for(let at=0;at<events.length;at++)if(events[at][0]===2){
     const initial=events[at][1];
     this.current={first:frame,at,initial,stage:initial.stage,last:frame,bytes:0};this.segments.push(this.current);
    }
    if(!this.current)continue;
    const bytes=JSON.stringify(events).length;
    this.records.set(frame,{events,bytes});this.bytes+=bytes;
    this.current.last=frame;this.current.bytes+=bytes;
    if(this.current.bytes>this.stageBytes){
     const discarded=this.current.first;this.segments.pop();this.current=null;
     for(const [f,r]of this.records)if(f>=discarded){this.records.delete(f);this.bytes-=r.bytes;}
    }
    while(this.bytes>this.totalBytes&&this.segments.length){if(this.segments.shift()===this.current)this.current=null;this.prune();}
    this.prune();
   }
  }catch(error){this.clear();this.error=error.message;}
 }
 prune(){
  const first=this.segments[0]?.first??Infinity;
  for(const [frame,r]of this.records){if(frame>=first)break;this.records.delete(frame);this.bytes-=r.bytes;}
 }
 frames(first,count){return Array.from({length:count},(_,n)=>this.records.get(first+n)?.events??null);}
 export(frames){return structuredClone(Array.from(this.records,([frame,r])=>[frame,r.events]).filter(([frame])=>frame<frames));}
 nearest(target){return this.segments.findLast(s=>s.stage>=1&&s.stage<=5&&s.first<=target&&s.last>=target-1)||null;}
}
