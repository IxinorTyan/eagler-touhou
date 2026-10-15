import {sha256} from './sha256.js';
// Confirmed MDRV2 events drive a Web Audio source. Network waits never seek it.
const MAGIC=new TextEncoder().encode('TH01-MUSIC-v01!!');
const DRIVER=new TextEncoder().encode('Mdrv2System');
export class NativeMusic {
  constructor(){this.cursor=0;this.mailbox=-1;this.epoch=0;this.sequences=new Map();this.candidates=[];}
  valid(heap,at,guestBase=null){
    if(at<0||at+24+32*16+2>heap.length||!MAGIC.every((b,i)=>heap[at+i]===b))return false;
    const v=new DataView(heap.buffer),segment=v.getUint16(at+16,true),offset=v.getUint16(at+18,true),base=at-segment*16-offset;
    if(!segment||v.getUint16(at+22,true)!==1||base<0||base+0xa0000>heap.length||(guestBase!==null&&base!==guestBase))return false;
    const driver=base+v.getUint16(base+0xf2*4+2,true)*16+0x102;
    return DRIVER.every((b,i)=>heap[driver+i]===b);
  }
  read(heap,guestBase=null){
    const v=new DataView(heap.buffer),out=[];
    // Executable transitions leave stale mailboxes. Scan in bounded chunks and
    // follow whichever validated resident game copy publishes a new sequence.
    // DOSBox exposes physical RAM independently of the current executable.
    // Its mailboxes live in conventional RAM, not in copies of EXEs elsewhere
    // in the WASM heap. Visit that 640 KiB range in at most ten reads, while
    // still draining every known mailbox on every step (including silence).
    const bounded=Number.isInteger(guestBase)&&guestBase>=0&&guestBase+0xa0000<=heap.length;
    const start=bounded?guestBase:0,limit=bounded?guestBase+0xa0000:heap.length;
    if(this.cursor<start||this.cursor>=limit)this.cursor=start;
    const end=Math.min(limit,this.cursor+(bounded?65536:1024*1024)),slice=heap.subarray(this.cursor,Math.min(limit,end+MAGIC.length));
    for(let p=slice.indexOf(MAGIC[0]);p>=0&&this.cursor+p<end;p=slice.indexOf(MAGIC[0],p+1)){
      const candidate=this.cursor+p;if(this.valid(heap,candidate,bounded?guestBase:null)&&!this.candidates.includes(candidate))this.candidates.push(candidate);
    }
    this.cursor=end===limit?start:end;this.candidates=this.candidates.filter(at=>at>=start&&at+538<=limit&&this.valid(heap,at,bounded?guestBase:null));
    for(const at of this.sequences.keys())if(!this.candidates.includes(at))this.sequences.delete(at);
    const newest=this.candidates.reduce((best,at)=>{const epoch=v.getUint16(at+536,true);return ((epoch-best)&65535)<32768&&epoch!==best?epoch:best;},this.epoch);
    if(newest!==this.epoch)this.epoch=newest;
    for(const at of this.candidates){
      const latest=v.getUint16(at+20,true),epoch=v.getUint16(at+536,true),before=this.sequences.get(at);
      if(epoch!==this.epoch)continue;
      let seq=before?.epoch===epoch?before.seq:0,n=(latest-seq)&65535;
      if(n>32){seq=latest<32?0:(latest-32)&65535;n=(latest-seq)&65535;}
      for(let i=0;i<n;i++){
        const expected=(seq+1)&65535,p=at+24+(seq&31)*16;if(v.getUint16(p,true)!==expected)throw Error('音乐事件队列不匹配');
        const name=new TextDecoder().decode(heap.subarray(p+4,p+16)).split('\0')[0].split(/[\\/]/).pop().replace(/\.MDT$/i,'').toUpperCase();
        out.push({command:v.getUint16(p+2,true),name});seq=expected;
      }
      this.sequences.set(at,{epoch,seq});if(n)this.mailbox=at;
    }
    return out;
  }
}
export class NetplayMusic {
  constructor(context,report=()=>{}){
    this.context=context;this.report=report;this.volume=context.createGain();this.volume.gain.value=.7;this.volume.connect(context.destination);
    this.manifest=null;this.active=null;this.requested=null;this.pending=[];this.encoded=new Map();this.downloads=new Map();
    this.abort=new AbortController();this.generation=0;this.closed=false;this.status='独立音乐：准备中';
  }
  statusText(text){this.status=text;this.report(text);}
  async load(){
    const r=await fetch(new URL('../bgm/manifest.json',import.meta.url),{cache:'no-store',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(15000)])});
    if(!r.ok)throw Error('音乐清单读取失败');this.manifest=await r.json();
    if(this.closed)return;this.statusText('独立音乐：等待游戏选曲');
    for(const event of this.pending.splice(0))this.command(event);
    this.download('reimu').catch(()=>{});
  }
  download(id){
    if(this.encoded.has(id))return Promise.resolve(this.encoded.get(id));if(this.downloads.has(id))return this.downloads.get(id);
    const track=this.manifest.tracks[id];if(!track)return Promise.reject(Error(`缺少曲目 ${id}`));
    const task=(async()=>{
      const r=await fetch(new URL('../bgm/'+track.url,import.meta.url),{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(30000)])});
      if(!r.ok)throw Error(`音乐下载失败：${id}`);const bytes=await r.arrayBuffer();
      if(await sha256(new Uint8Array(bytes))!==track.audioSha256)throw Error(`音乐校验失败：${id}`);
      if(!this.closed)this.encoded.set(id,bytes);return bytes;
    })();
    this.downloads.set(id,task);task.then(()=>this.downloads.delete(id),()=>this.downloads.delete(id));return task;
  }
  setVolume(value){this.volume.gain.setTargetAtTime(Math.max(0,Math.min(1,value)),this.context.currentTime,.015);}
  retire(){
    const item=this.active;if(!item)return;const now=this.context.currentTime;
    item.gain.gain.cancelAndHoldAtTime(now);item.gain.gain.linearRampToValueAtTime(0,now+.015);item.source.stop(now+.016);this.active=null;
  }
  stop(){this.generation++;this.requested=null;this.retire();this.statusText('独立音乐：已停止');}
  play(name){
    const id=this.manifest.headers[name];this.retire();const generation=++this.generation;
    if(!id){this.requested=null;this.statusText(`音乐错误：缺少曲目 ${name}`);return;}
    const item={id,generation,fadeAt:null};this.requested=item;this.statusText(`独立音乐：加载 ${id}…`);
    this.download(id).then(bytes=>{
      if(this.closed||generation!==this.generation)return null;return this.context.decodeAudioData(bytes.slice(0));
    }).then(buffer=>{
      if(!buffer||this.closed||generation!==this.generation)return;
      const track=this.manifest.tracks[id];if(track.loopEnd>buffer.duration+.025)throw Error(`曲目长度不足：${id}`);
      const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;
      source.loop=track.loopEnd>track.loopStart;source.loopStart=track.loopStart;source.loopEnd=Math.min(track.loopEnd,buffer.duration);
      source.connect(gain);gain.connect(this.volume);item.source=source;item.gain=gain;this.active=item;
      source.onended=()=>{source.disconnect();gain.disconnect();if(this.active===item)this.active=null;};
      source.start();
      if(item.fadeAt!==null){const left=item.fadeAt-this.context.currentTime;if(left<=0){source.stop();this.active=null;return;}gain.gain.value=Math.min(1,left/item.fadeDuration);gain.gain.linearRampToValueAtTime(0,item.fadeAt);source.stop(item.fadeAt+.01);}
      this.statusText(`独立音乐：${id}`);
      // Only source.buffer retains decoded PCM; compressed songs stay cached.
    }).catch(e=>{if(!this.closed&&generation===this.generation)this.statusText(`音乐错误：${e.message}`);});
  }
  fade(duration){
    const item=this.requested;if(!item||item.generation!==this.generation)return;const now=this.context.currentTime;
    item.fadeAt=now+duration;item.fadeDuration=duration;
    if(item.gain){item.gain.gain.cancelAndHoldAtTime(now);item.gain.gain.linearRampToValueAtTime(0,item.fadeAt);item.source.stop(item.fadeAt+.01);}
  }
  command(event){
    if(this.closed)return;if(!this.manifest){this.pending.push(event);if(this.pending.length>64)this.pending.shift();return;}
    if(event.command===0)this.play(event.name);
    else if(event.command===3)this.stop();
    // MDRV2 attenuates once per two Timer-B interrupts, up to 127 steps.
    else if(event.command===2)this.fade(this.manifest.tracks[this.requested?.id]?.fadeSeconds??2.5);
  }
  dispose(){if(this.closed)return;this.closed=true;this.abort.abort();this.stop();this.pending=[];this.encoded.clear();this.downloads.clear();this.volume.disconnect();}
}
