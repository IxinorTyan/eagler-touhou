// Yield without the nested setTimeout(0) minimum delay. Used only for loading,
// hashing and bounded boot work; emulated time never comes from this clock.
let channel;
const pending=[];
export function yieldHost(){
  channel??=new MessageChannel();
  channel.port1.onmessage=()=>pending.shift()?.();
  return new Promise(resolve=>{pending.push(resolve);channel.port2.postMessage(0);});
}
