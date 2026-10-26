// Read-only, bounded gameplay probe in browser JS. This is not a savestate or
// a full-world checksum. The existing 640 KiB checksum is reused every 120 frames.
export function historyProof(heap,mailbox,patch,{frame,oldP1,paused,escapeTicks,lastPauseRequests,pauseHeld=[]}){
  const code=mailbox-patch.mailbox_cs_offset,data=code+(patch.data_segment-patch.code_segment)*16;
  let hash=2166136261;
  const byte=n=>{hash=Math.imul(hash^n,16777619);};
  const word=n=>{for(let k=0;k<4;k++)byte(n>>>(k*8)&255);};
  const span=(at,size)=>{for(let n=at;n<at+size;n++)byte(heap[n]);};
  for(const [offset,size]of [[0x418,4],[0x36d0,40],[0x4ad4,4],[0x576e,10]])span(data+offset,size);
  span(mailbox+16,74); // native ticks, generation, positions and guest state
  const p=patch.mailbox_offsets,e=patch.entry_map,count=heap[code+e.player_count];
  span(mailbox+p.stats,count*4);span(mailbox+p.out_flags,count);span(mailbox+p.rescue_progress,count);
  span(code+e.p3_state,40);span(code+e.rescue_target,count);
  if(patch.personal_stats)span(code+patch.personal_stats.cs_offset,count*patch.personal_stats.stride);
  for(const n of [frame,oldP1,paused?1:0,escapeTicks,lastPauseRequests])word(n);
  for(const held of pauseHeld)word(held);
  return {ticks:new DataView(heap.buffer).getUint32(mailbox+16,true),gameHash:hash>>>0};
}
