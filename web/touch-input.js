// Touch buttons become ordinary input bits, sampled by the caller.
// No vertical movement, position writes or native updates run on pointer events.
export const TOUCH_BOMB=4096;
// phase 0 also covers a nonfatal miss animation. Native flags distinguish it
// from title/route/score menus without guessing from the animation duration.
export function readHitRecovery(view,bridge,offsets){
  if(!offsets||!['PLAYER_IS_HIT','STAGE_CLEARED','GAME_CLEARED','REM_LIVES'].every(name=>Number.isInteger(offsets[name])))return false;
  return view.getUint16(bridge+18,true)===0&&view.getUint16(bridge+210,true)===0&&
    !!view.getUint8(bridge+offsets.PLAYER_IS_HIT)&&!view.getUint16(bridge+offsets.STAGE_CLEARED,true)&&
    !view.getUint8(bridge+offsets.GAME_CLEARED)&&view.getInt16(bridge+offsets.REM_LIVES,true)>0;
}
export class HorizontalTouchInput{
  constructor(){this.reset();}
  reset(){this.held=new Map();this.pulses=0;}
  end(id){this.held.delete(id);}
  press(id,bits,{pulseOnly=false,menu=false}={}){
    this.pulses|=menu?bits:bits&~3;
    this.held.set(id,pulseOnly?0:bits);
  }
  sample(left,{play=true,ghost=false}={}){
    let bits=this.pulses;this.pulses=0;
    for(const value of this.held.values())bits|=value;
    if(play&&ghost)bits&=~(4|8|TOUCH_BOMB);
    return bits;
  }
}
