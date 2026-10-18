import {TICK_MS} from '../frame-queue.js';

export const SYNC_PROTOCOL='th03-rollback/6';
export const MAX_INPUT_DELAY=6,RTT_SAMPLES=3,ZERO_DELAY_RTT_MS=20;
export function validInputReport(report){
  return report&&typeof report.rollbackEnabled==='boolean'
    &&Number.isSafeInteger(report.rttMs)&&report.rttMs>=0
    &&Number.isSafeInteger(report.maxRttMs)&&report.maxRttMs>=report.rttMs&&report.maxRttMs<=60000;
}
export function chooseInputPolicy(local,remote){
  if(!validInputReport(local)||!validInputReport(remote)||local.rollbackEnabled!==remote.rollbackEnabled)throw Error('双方输入缓冲策略不一致');
  const rttMs=Math.max(local.rttMs,remote.rttMs),rollbackEnabled=local.rollbackEnabled;
  return {schema:1,rollbackEnabled,rttMs,inputDelay:rollbackEnabled&&rttMs>ZERO_DELAY_RTT_MS?Math.min(MAX_INPUT_DELAY,Math.ceil(rttMs/2/TICK_MS)+1):0};
}
export function validInputPolicy(policy){
  return policy&&policy.schema===1&&typeof policy.rollbackEnabled==='boolean'
    &&Number.isSafeInteger(policy.rttMs)&&policy.rttMs>=0&&policy.rttMs<=60000
    &&Number.isInteger(policy.inputDelay)&&policy.inputDelay>=0&&policy.inputDelay<=MAX_INPUT_DELAY
    &&(policy.rollbackEnabled||policy.inputDelay===0);
}
