import {RollbackQueue} from './rollback-queue.js';
export {PROTOCOL,TICK_MS,MAX_ROLLBACK} from './rollback-queue.js';
// Idempotent native menu requests (128 remains a direct Escape toggle).
export const PAUSE=512,RESUME=1024;
export const ROLLBACK_ARM_AHEAD=120,REPLAY_MAX_STEPS=4,REPLAY_BUDGET_MS=6;
// Match TH04's paced prediction: retain 12-step recovery history, but never
// simulate beyond the six-step held-direction horizon on the faster peer.
export const PREDICTION_LEAD_LIMIT=6;
export function inputPolicy(transport,rollbackEnabled){
  return Object.freeze({inputDelay:0,directionPrediction:PREDICTION_LEAD_LIMIT,rollbackEnabled});
}
export function nextInputs(queue,allowPrediction=true){
  if(queue.active&&queue.frame-queue.confirmed>=PREDICTION_LEAD_LIMIT){
    queue.waitReason='prediction-lead';return null;
  }
  return queue.peek(allowPrediction);
}
export class GameQueue extends RollbackQueue {
  constructor(slot,rollback=false,players=2,policy=inputPolicy('rtc',rollback)){
    super(slot,players,policy);
    if(policy.rollbackEnabled!==rollback)throw Error('回滚配置与输入策略不一致');
  }
  receive(packet){super.receive(packet.frame,packet.buttons,packet.slot);}
  commit(pair){
    const at=this.frame;super.commit(pair);
    // Authoritative input can arrive while the worker is executing this step.
    if(pair.some((value,slot)=>value!==this.predicted(slot,at)))this.dirty=this.dirty===null?at:Math.min(this.dirty,at);
  }
}

// Plan a bounded historical slice without advancing the live queue. Inputs
// may arrive while its Worker runs; commit() checks every applied pair again.
export function planReplay(queue,target,allowPrediction){
  const cursor=Object.create(queue),plans=[];
  for(;cursor.frame<target&&plans.length<REPLAY_MAX_STEPS;cursor.frame++){
    const pair=nextInputs(cursor,allowPrediction);if(!pair)break;
    plans.push({frame:cursor.frame,pair,predicted:cursor.active&&cursor.frame>=cursor.confirmed,
      authoritative:cursor.inputs.every((lane,slot)=>cursor.isOffline(slot,cursor.frame)||lane.has(cursor.frame)),offlineMask:cursor.offlineMask(),end:cursor.frame+1===target});
  }
  return plans;
}
