// MAIN's image is present before its first player tick. Keep every signature
// candidate, including inactive copies, instead of rescanning the entire WASM
// heap while MAIN initializes. Periodic discovery also handles a reloaded image.
const signature=new TextEncoder().encode('TH05LOCALv002!!\0');
export function createGameLocator(){
  let candidates=[],calls=0;
  const metrics={fullScans:0,candidateChecks:0};
  function discover(heap){
    candidates=[];metrics.fullScans++;
    for(let at=heap.indexOf(signature[0]);at>=0;at=heap.indexOf(signature[0],at+1)){
      let i=1;while(i<signature.length&&heap[at+i]===signature[i])i++;
      if(i===signature.length)candidates.push(at);
    }
  }
  return {metrics,find(heap,patch,refresh=false){
    if(refresh||calls++%8===0)discover(heap);
    const view=new DataView(heap.buffer,heap.byteOffset,heap.byteLength),found=[];
    for(const at of candidates){
      metrics.candidateChecks++;
      if(at+26>heap.length||!signature.every((b,i)=>heap[at+i]===b)||heap[at+25]!==1||view.getUint32(at+16,true)===0)continue;
      const origin=at-patch.mailbox_cs_offset-(view.getUint16(at+20,true)-patch.data_segment+patch.code_segment)*16;
      if(origin>=0&&origin+0x100000<=heap.length)found.push([at,origin]);
    }
    return found.length===1?found[0]:null;
  }};
}
