import {unpackTouch,ALWAYS_POINT} from './touch-input.js';
import {nativePlayers} from './native-players.js';
export function nativeHitPoints(heap,mailbox,patch,inputs){
  if(mailbox<0)return [];
  const view=new DataView(heap.buffer),code=mailbox-patch.mailbox_cs_offset,d=code+(patch.data_segment-patch.code_segment)*16;
  const layout=nativePlayers(heap,mailbox,patch);
  return layout.players.map((_,slot)=>{
    const at=layout.liveStates[slot],value=inputs[slot]||0;
    const visible=(value&64)||Math.floor(value/ALWAYS_POINT)%2;
    return visible&&!heap[mailbox+patch.mailbox_offsets.out_flags+slot]&&!heap[at+36]&&!heap[at+31]
      ?[(view.getInt16(at+2,true)>>4)+32,(view.getInt16(at+4,true)>>4)+16]:[-100,-100];
  });
}
export function writeNativeTouch(heap,mailbox,patch,inputs,blocked=false){
  if(mailbox<0)return;
  const view=new DataView(heap.buffer),base=mailbox-patch.mailbox_cs_offset+patch.entry_map.touch_state;
  for(let slot=0;slot<3;slot++){
    const at=base+slot*8,touch=unpackTouch(inputs[slot]||0);
    if(blocked||!touch.active){view.setUint16(at,0,true);view.setInt32(at+2,0,true);continue;}
    const clamp=v=>Math.max(-8192,Math.min(8191,v));
    if(touch.begin)view.setInt32(at+2,0,true);
    view.setUint16(at,touch.unlimited?3:1,true);
    view.setInt16(at+2,clamp(view.getInt16(at+2,true)+touch.x),true);
    view.setInt16(at+4,clamp(view.getInt16(at+4,true)+touch.y),true);
  }
}
