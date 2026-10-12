const STORAGE='th01.performance.mode.v1';
const modes=['auto','60','30'];
export function readPerformanceMode(){
  try{const value=localStorage.getItem(STORAGE);if(modes.includes(value))return value;}catch{}
  return 'auto';
}
export function writePerformanceMode(mode){
  mode=modes.includes(mode)?mode:'auto';try{localStorage.setItem(STORAGE,mode);}catch{}return mode;
}
export function nextPerformanceMode(){return writePerformanceMode(modes[(modes.indexOf(readPerformanceMode())+1)%modes.length]);}
export function performanceModeLabel(mode=readPerformanceMode()){
  return mode==='30'?'画面：省性能':mode==='60'?'画面：流畅':'画面：自动';
}
export function createPresentationLimiter(mode=readPerformanceMode()){
  let last=-Infinity,current=mode,lastFrame=null,decision=true;
  const reduced=()=>current==='30'||(current==='auto'&&((globalThis.navigator?.hardwareConcurrency||8)<=4||(globalThis.navigator?.deviceMemory||8)<=4));
  return {setMode(value){current=writePerformanceMode(value);last=-Infinity;lastFrame=null;},mode:()=>current,
    allow(now=performance.now(),frame=null){
      if(frame!==null&&frame!==undefined&&frame===lastFrame)return decision;
      lastFrame=frame;
      decision=!reduced()||now-last>=1000/30-.5;
      if(decision)last=now;
      return decision;
    }};
}
