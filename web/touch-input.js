// Browser gestures become ordinary horizontal buttons, sampled by the caller.
// No vertical movement, position writes or native updates run on pointer events.
export const TOUCH_BOMB=4096;
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export class HorizontalTouchInput{
  constructor(){this.reset();}
  reset(){this.drag=null;this.held=new Map();this.pulses=0;}
  start(id,x,left,scale,gain=1.5){
    if(this.drag||!Number.isFinite(left)||!(scale>0))return false;
    this.drag={id,x,target:left,scale,gain};return true;
  }
  move(id,x){
    if(this.drag?.id!==id)return;
    const d=this.drag;d.target=clamp(d.target+(x-d.x)*d.gain/d.scale,0,608);d.x=x;
  }
  end(id){if(this.drag?.id===id)this.drag=null;this.held.delete(id);}
  press(id,bits,{pulseOnly=false}={}){
    this.pulses|=bits;
    this.held.set(id,pulseOnly?0:bits);
  }
  sample(left,{play=true,ghost=false}={}){
    let bits=this.pulses;this.pulses=0;
    for(const value of this.held.values())bits|=value;
    if(play&&this.drag&&Number.isFinite(left)){
      const distance=this.drag.target-left;
      // Native regular movement is four pixels/frame. Avoid alternating keys at rest.
      bits&=~3;if(Math.abs(distance)>4)bits|=distance<0?1:2;
    }
    if(play&&ghost)bits&=~(4|8|TOUCH_BOMB);
    return bits;
  }
}
