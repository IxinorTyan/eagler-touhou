// TH04 solo protocol, with TH05's native player/data addresses. Only the live
// single-player mailbox accepts movement; disk buffers and retired allocations
// are never input targets. Movement is consumed by the original player update.
export class SoloInput {
  constructor(patch){
    this.patch=patch;this.signature=new TextEncoder().encode(patch.signature);
    this.at=-1;this.cursor=0;this.seen=new Map();this.snapshot=null;this.lastInput=0;
  }
  valid(heap,at){
    if(at<0||at+this.patch.mailbox_size>heap.length||!this.signature.every((b,i)=>heap[at+i]===b))return false;
    const v=new DataView(heap.buffer,heap.byteOffset,heap.byteLength),ds=v.getUint16(at+20,true);
    const base=at-this.patch.mailbox_cs_offset-(ds-this.patch.data_segment+this.patch.code_segment)*16;
    return ds>0&&base>=0&&base+0x100000<=heap.length;
  }
  clear(heap,at=this.at){if(this.valid(heap,at))heap.fill(0,at+28,at+36);}
  read(heap,now=performance.now()){
    const v=new DataView(heap.buffer,heap.byteOffset,heap.byteLength),previous=this.at;
    this.at=-1;
    for(const [at,candidate]of this.seen){
      if(!this.valid(heap,at)){this.seen.delete(at);continue;}
      const ticks=v.getUint32(at+16,true);
      if(ticks!==candidate.ticks){candidate.ticks=ticks;candidate.changed=now;}
      const mode=heap[at+22];
      if(mode!==0&&(now-candidate.changed<200||mode===2||mode===3))this.at=at;
    }
    if(this.at<0){
      if(this.cursor>=heap.length)this.cursor=0;
      const end=Math.min(this.cursor+2*1024*1024,heap.length);
      const slice=heap.subarray(this.cursor,Math.min(end+this.signature.length,heap.length));
      for(let i=slice.indexOf(this.signature[0]);i>=0&&this.cursor+i<end;i=slice.indexOf(this.signature[0],i+1)){
        const at=this.cursor+i;
        if(this.valid(heap,at)&&v.getUint32(at+16,true)&&!this.seen.has(at))this.seen.set(at,{ticks:0,changed:-Infinity});
      }
      this.cursor=end;
    }
    if(previous!==this.at)this.clear(heap,previous);
    if(this.at<0){this.snapshot=null;return null;}
    const at=this.at,data=at-this.patch.mailbox_cs_offset+(this.patch.data_segment-this.patch.code_segment)*16;
    if(now-this.lastInput>750||heap[at+22]!==1||heap[at+23])this.clear(heap);
    return this.snapshot={at,mode:heap[at+22],flags:heap[at+23],ticks:v.getUint32(at+16,true),
      generation:v.getUint16(at+24,true),pointOptions:heap[at+26],touchFlags:v.getUint16(at+28,true),
      x:v.getInt16(data+0x36d2,true)/16,y:v.getInt16(data+0x36d4,true)/16,
      focus:heap[data+0x3066],stage:heap[data+0x576e],character:heap[data+0x5773]};
  }
  write(heap,input,paused=false){
    const at=this.at;if(!this.valid(heap,at))return;
    const v=new DataView(heap.buffer,heap.byteOffset,heap.byteLength);
    if(input.generation!==v.getUint16(at+24,true))return;
    this.lastInput=performance.now();heap[at+26]=(input.points??1)&9;
    const t=input.touch;
    if(paused||heap[at+22]!==1||heap[at+23]||!t?.active){this.clear(heap);return;}
    v.setUint16(at+28,t.unlimited?3:1,true);
    for(const [offset,delta]of [[30,t.x],[32,t.y]]){
      const pending=v.getInt16(at+offset,true)+(Number.isFinite(delta)?delta:0);
      v.setInt16(at+offset,Math.max(-8192,Math.min(8191,pending)),true);
    }
  }
  markers(heap){
    const at=this.at;if(!this.valid(heap,at)||heap[at+22]!==1||heap[at+23])return [];
    const data=at-this.patch.mailbox_cs_offset+(this.patch.data_segment-this.patch.code_segment)*16;
    if(!(heap[at+26]&8)&&!((heap[at+26]&1)&&heap[data+0x3066]))return [];
    const v=new DataView(heap.buffer,heap.byteOffset,heap.byteLength);
    return [[(v.getInt16(data+0x36d2,true)>>4)+32,(v.getInt16(data+0x36d4,true)>>4)+16]];
  }
}
