import {loadVerifiedBytes} from '../startup-assets.js';
// Complete original FM effects run on the audio device's clock. Network waits
// never refill, stop, loop or stretch a sound that has already started.
export class LocalSfx {
  constructor(context){
    this.context=context;this.buffers=new Map();this.active=null;this.closed=false;
    this.lastFrame=-1;this.played=0;this.superseded=0;this.status='音效准备中';
    this.onState=()=>{if(context.state!=='running')this.flush();};
    context.addEventListener('statechange',this.onState);
  }
  async load(){
    const response=await fetch(new URL('../sfx/manifest.json',import.meta.url),{cache:'no-store'});
    if(!response.ok)throw Error('音效清单读取失败');
    const m=await response.json();
    if(m.version!==1||m.format!=='s16le'||m.channels!==1||m.sampleRate!==44100||m.effects.length!==16)throw Error('音效清单格式不匹配');
    const bytes=await loadVerifiedBytes(new URL('../sfx/'+m.url,import.meta.url),m.sha256,{size:m.bytes});
    if(this.closed)return;
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for(const e of m.effects){
      if(!Number.isInteger(e.id)||e.id<0||e.id>15||!Number.isInteger(e.offset)||!Number.isInteger(e.frames)||e.offset<0||e.frames<0||(e.offset+e.frames)*2>bytes.length)throw Error('音效样本边界无效');
      if(!e.frames)continue;
      const buffer=this.context.createBuffer(1,e.frames,m.sampleRate),pcm=buffer.getChannelData(0);
      for(let i=0;i<e.frames;i++)pcm[i]=view.getInt16((e.offset+i)*2,true)/32768;
      this.buffers.set(e.id,buffer);
    }
    this.status='独立音效已就绪';
  }
  flush(){
    const item=this.active;if(!item)return;this.active=null;
    const now=this.context.currentTime;
    item.gain.gain.cancelScheduledValues(now);item.gain.gain.setValueAtTime(1,now);
    item.gain.gain.linearRampToValueAtTime(0,now+0.003);
    try{item.source.stop(now+0.003);}catch{}
  }
  push(events){
    if(this.closed)return;
    // PMD has one FM effect part. Catch-up confirmation keeps its latest
    // trigger instead of replaying an accumulated queue of obsolete effects.
    let latest=null;
    for(const e of events){
      if(!Number.isSafeInteger(e.frame)||!Number.isInteger(e.id)||e.id<0||e.id>15)throw Error('音效事件无效');
      if(e.frame<this.lastFrame)continue;
      if(!latest||e.frame>=latest.frame)latest=e;
    }
    if(!latest)return;
    if(latest.frame<=this.lastFrame)return;
    this.lastFrame=latest.frame;this.superseded+=events.length-1;
    if(this.context.state!=='running')return;
    this.flush();const buffer=this.buffers.get(latest.id);if(!buffer)return;
    const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;
    source.connect(gain);gain.connect(this.context.destination);
    const item={source,gain,id:latest.id,frame:latest.frame};this.active=item;
    source.onended=()=>{source.disconnect();gain.disconnect();if(this.active===item)this.active=null;};
    source.start();this.played++;
  }
  info(){return {mode:'local-effects',status:this.status,played:this.played,superseded:this.superseded,lastFrame:this.lastFrame,active:this.active?.id??null};}
  disconnect(){this.closed=true;this.flush();this.buffers.clear();this.context.removeEventListener('statechange',this.onState);}
}
