import {BOOT_DELAY,MAX_INPUT_DELAY,MAX_ROLLBACK_INPUT_DELAY,rollbackRttForSamples,rollbackInputDelayForRtt,lockstepDelayForRtt} from './rollback-queue.js';
export function validateTimingReport(report){
  if(!report||!Number.isFinite(report.rtt)||!Number.isFinite(report.rollbackRtt)||
    report.rtt<0||report.rtt>30000||report.rollbackRtt<0||report.rollbackRtt>report.rtt)throw Error('无效开局延迟测量');
  return {rtt:report.rtt,rollbackRtt:report.rollbackRtt};
}
export function timingReport(samples){
  if(!Array.isArray(samples)||!samples.length)throw Error('开局延迟测量不完整');
  const medians=samples.map(rollbackRttForSamples);
  return validateTimingReport({rtt:Math.max(...samples.flat()),rollbackRtt:Math.max(...medians)});
}
export function validateStartupPolicy(policy,rollbackEnabled){
  if(!policy||!Number.isInteger(policy.delay)||policy.delay<BOOT_DELAY||policy.delay>MAX_INPUT_DELAY||
    !Number.isInteger(policy.inputDelay)||policy.inputDelay<0||policy.inputDelay>MAX_ROLLBACK_INPUT_DELAY||
    policy.inputDelay>policy.delay||(!rollbackEnabled&&policy.inputDelay!==0)||
    (rollbackEnabled&&policy.delay!==Math.max(BOOT_DELAY,policy.inputDelay)))throw Error('无效开局输入策略');
  return Object.freeze({delay:policy.delay,inputDelay:policy.inputDelay});
}
export function selectStartupPolicy(reports,rollbackEnabled){
  if(!Array.isArray(reports)||![2,3].includes(reports.length))throw Error('全员开局测量不完整');
  const valid=reports.map(validateTimingReport);
  const inputDelay=rollbackEnabled?rollbackInputDelayForRtt(Math.max(...valid.map(r=>r.rollbackRtt))):0;
  const delay=rollbackEnabled?Math.max(BOOT_DELAY,inputDelay):lockstepDelayForRtt(Math.max(...valid.map(r=>r.rtt)));
  return validateStartupPolicy({delay,inputDelay},rollbackEnabled);
}
