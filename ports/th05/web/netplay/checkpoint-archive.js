import {sha256} from './sha256.js';
export const CHECKPOINT_INTERVAL=1800,CHECKPOINT_LIMIT=128,CHECKPOINT_BYTES=128*1024*1024;
export class CheckpointArchive{
  constructor(){this.entries=[];this.bytes=0;this.failed=null;}
  async append(entry){
    const {frame,stage,bytes}=entry;
    if(!Number.isInteger(frame)||frame<0||frame>216000||!Number.isInteger(stage)||stage<0||stage>6||!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>16*1024*1024)throw Error('检查点索引无效');
    if(this.entries.length&&frame<=this.entries.at(-1).frame||!this.entries.length&&frame!==0)throw Error('检查点顺序无效');
    if(this.entries.length>=CHECKPOINT_LIMIT||this.bytes+bytes.length>CHECKPOINT_BYTES)throw Error('检查点缓存已达容量，已保留现有检查点');
    const sha=await sha256(bytes);if(entry.sha&&entry.sha!==sha)throw Error('检查点摘要不一致');
    const saved={frame,stage,sha,bytes};this.entries.push(saved);this.bytes+=bytes.length;return saved;
  }
  nearest(frame){for(let n=this.entries.length-1;n>=0;n--)if(this.entries[n].frame<=frame)return this.entries[n];return null;}
  get base(){return this.entries[0]||null;}
  index(){return this.entries.map(({frame,stage,sha,bytes})=>({frame,stage,sha,size:bytes.length}));}
}
