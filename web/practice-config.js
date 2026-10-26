// Shared strict schema for UI, Worker and existing browser REP files.
export const PRACTICE_VERSION='th05-browser-practice/4';
export const PRACTICE_FIXED_OPTIONS=Object.freeze({lastLife:false,autoBomb:false,autoRetry:false});
export const PRACTICE_DEFAULTS=Object.freeze({enabled:true,invincible:false,lockLives:false,lockBombs:false,lockPower:false,lockTime:false,enemyInvincible:false,lockRank:false,disableBomb:false,disableFocus:false,disableShot:false,forceFocus:false,quickRetry:true,preparedRetry:true,showKeys:false,showInfo:false,alwaysPoint:false,speed:1,...PRACTICE_FIXED_OPTIONS});
export const PRACTICE_SETUP=Object.freeze({stage:0,character:0,difficulty:1,entry:'stage',phase:0,branch:'auto',lives:0,bombs:0,power:128,dream:0,rank:32,hp:0});
export const PRACTICE_PHASES=Object.freeze([[2,3,4],[2,4,5,7],[3,5,6,8,9,11,12,14],[2],[2,4,5,7,8,10],[2,3,6,7,9,10,12],[2,4,6,8,10,12,14,16,17]]);
const ranges={stage:[0,6],character:[0,3],difficulty:[0,4],phase:[0,17],lives:[0,8],bombs:[0,8],power:[1,128],dream:[0,128],rank:[0,64],hp:[0,30000]};
export function validatePracticeOptions(value,partial=false){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('练习选项无效');
  for(const [k,v]of Object.entries(value)){
    if(!(k in PRACTICE_DEFAULTS))throw Error('未知练习选项');
    if(k==='speed'?![.25,.5,.75,1,1.5,2].includes(v):typeof v!=='boolean')throw Error('练习选项无效');
  }
  if(!partial&&Object.keys(PRACTICE_DEFAULTS).some(k=>!(k in value)))throw Error('练习选项不完整');
  return value;
}
export function normalizePracticeSetup(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('练习起点无效');
  for(const [k,v]of Object.entries(value)){
    if(!(k in PRACTICE_SETUP))throw Error('未知练习起点');
    if(k in ranges){const [low,high]=ranges[k];if(!Number.isInteger(v)||v<low||v>high)throw Error('练习参数超出范围：'+k);}
    else if(!(k==='entry'?['stage','mid','boss']:['auto','mai','yuki']).includes(v))throw Error('练习入口无效');
  }
  const s={...PRACTICE_SETUP,...value};
  s.lives=0;s.bombs=0;
  if(s.stage===6||s.difficulty===4){s.stage=6;s.difficulty=4;}
  if(s.entry==='mid'&&s.stage===5)throw Error('六面没有道中 Boss');
  if(s.entry==='stage')s.phase=0;
  if(s.entry==='mid'&&!(s.stage===0?[0,3]:s.stage===1?[0,1,2]:[0,1]).includes(s.phase))throw Error('道中阶段无效');
  if(s.entry==='boss'&&s.phase&&!((s.stage===3&&s.branch!=='auto'?[3,5,7,9]:PRACTICE_PHASES[s.stage]).includes(s.phase)))throw Error('Boss 阶段无效');
  return s;
}
export function normalizePractice(value){
  if(!value||value.version!==PRACTICE_VERSION)throw Error('练习版本不支持');
  const mode=value.mode??'target';if(!['full','target'].includes(mode))throw Error('单人流程类型无效');
  const setup=normalizePracticeSetup(value.setup),options={...PRACTICE_DEFAULTS,...validatePracticeOptions(value.options||{},true),...PRACTICE_FIXED_OPTIONS};
  return {version:PRACTICE_VERSION,mode,setup,options};
}
export function createPracticeClock(initial=1){
  let speed=initial,anchor=performance.now(),elapsed=anchor,paused=false;const epoch=Date.now()-anchor;
  const now=()=>elapsed+(paused?0:(performance.now()-anchor)*speed);
  const RealDate=Date;
  function PracticeDate(...args){if(!new.target)return new RealDate(epoch+now()).toString();return Reflect.construct(RealDate,args.length?args:[epoch+now()],new.target);}
  Object.setPrototypeOf(PracticeDate,RealDate);PracticeDate.prototype=RealDate.prototype;PracticeDate.now=()=>Math.floor(epoch+now());
  const hostPerformance=new Proxy(performance,{get(t,k){if(k==='now')return now;const value=Reflect.get(t,k,t);return typeof value==='function'?value.bind(t):value;}});
  return {Date:PracticeDate,performance:hostPerformance,now,date:()=>Math.floor(epoch+now()),get speed(){return speed;},setPaused(value){elapsed=now();anchor=performance.now();paused=!!value;},setSpeed(value){if(![.25,.5,.75,1,1.5,2,8].includes(value))throw Error('无效变速');elapsed=now();anchor=performance.now();speed=value;}};
}
