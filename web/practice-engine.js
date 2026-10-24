import {normalizePractice,validatePracticeOptions,PRACTICE_FIXED_OPTIONS} from './practice-config.js';
// All writes happen on synchronous guest marker ports, never on display ticks.
// Existing DOS state machines perform entry, attack setup, death and Bombs.
const fixed=[{4:1300},{},{5:600,8:600,11:600,14:1000},{},{4:2000,7:2000,8:2000,10:1200},{6:3000,7:3000,9:3000,10:3000,12:3000},{4:4001,8:4001,12:4001,17:5001}];
const cycles=[{2:32,3:24},{2:20,4:20,5:20,7:10},{3:24,6:24,9:24,12:24},{2:36},{2:20,5:20},{2:16,3:16},{2:32,6:32,10:32,14:32,16:9}];
// Original attack HP ranges, cross-checked against ReC98 and PracticeSections.h.
// The first value is the full attack entry HP, the second its defeat threshold.
const bossHp=[
 {2:[4650,2550],3:[2550,450],4:[450,0]},
 {2:[4400,3000],4:[3000,1900],5:[1900,500],7:[500,0]},
 {3:[9600,7400],5:[7400,5200],6:[7400,5200],8:[5200,3000],9:[5200,3000],11:[3000,800],12:[3000,800],14:[800,0]},
 {2:[4500,0]},
 {2:[8300,7500],4:[7500,5700],5:[5700,4500],7:[4500,2700],8:[2700,1200],10:[1200,0]},
 {2:[22800,20600],3:[20600,18400],6:[18400,14600],7:[14600,11600],9:[11600,8600],10:[8600,2800],12:[2800,0]},
 {2:[26500,23800],4:[23800,21000],6:[21000,18100],8:[18100,15100],10:[15100,12600],12:[12600,9600],14:[9600,6800],16:[6800,3400],17:[3400,0]},
];
const branchHp={mai:{3:[7800,5800],5:[5800,2800],7:[2800,1200],9:[1200,0]},yuki:{3:[7900,4600],5:[4600,3200],7:[3200,1200],9:[1200,0]}};
const midHp=[{3:[1000,0]},{1:[1400,400],2:[400,0]},{1:[1400,0]},{1:[1100,0]},{1:[1550,0]},{},{1:[3000,0]}];
const midFixed=[{3:1500},{1:1000,2:800},{},{},{},{},{}],midCycles=[0,0,13,16,16,0,20];
export function createPracticeEngine({mod,patch,config,onState=()=>{},onComplete=()=>{},clock}){
  const normalized=normalizePractice(config),setup=normalized.setup,targeted=normalized.mode==='target';let options=normalized.options;
  let base=-1,d=-1,csBase=-1,resident=-1,frames=0,ready=false,preparing=true,initialized=false,lastMiss=0,misses=0,bombsUsed=0,initialPending=true,error=null;
  let snapshot=null,elapsed=0,phaseKey='',phaseFrames=0,prepareFrames=0,lastBombing=false,warped=false;
  let outcome=null,observedBoss=false,waiting=false,lastNativeBombs=0,lockedPower=null;
  const h=()=>mod.HEAPU8,v=()=>new DataView(h().buffer),u8=n=>h()[d+n],u16=n=>v().getUint16(d+n,true),i16=n=>v().getInt16(d+n,true),w8=(n,x)=>{h()[d+n]=x;},w16=(n,x)=>v().setUint16(d+n,x,true);
  function locate(packed){
    const cs=packed&65535,ds=packed>>>16,heap=h();
    if(base>=0){csBase=base+cs*16;d=base+ds*16;return;}
    const sig=new TextEncoder().encode(patch.signature),view=v();
    for(let at=heap.indexOf(sig[0]);at>=0;at=heap.indexOf(sig[0],at+1)){
      if(!sig.every((b,i)=>heap[at+i]===b))continue;
      const b=at-patch.mailbox_cs_offset-cs*16,data=b+ds*16;
      if(b<0||b+0x100000>heap.length)continue;
      const r=b+view.getUint16(data+0x41fe,true)*16+view.getUint16(data+0x41fc,true);
      if(new TextDecoder().decode(heap.subarray(r,r+9))!=='KSOConfig')continue;
      base=b;d=data;csBase=b+cs*16;resident=r;return;
    }
    throw Error('无法定位原版练习运行实例');
  }
  function resources(){
    w8(0x4ad4,setup.lives+1);w8(0x4ad5,setup.bombs);w8(0x36f0,setup.power);w8(0x36f6,setup.dream);
    const limits=[[16,32],[24,40],[44,54],[48,58],[32,32]][setup.difficulty];w8(0x5770,Math.max(limits[0],Math.min(limits[1],setup.rank)));
  }
  function locks(){
    // The native count includes the current life. Never replenish Bombs or
    // carry a pickup into another attempt.
    if(targeted){w8(0x4ad4,1);w8(0x4ad5,0);}
    if(options.lockPower&&ready){lockedPower??=u8(0x36f0);w8(0x36f0,lockedPower);}
    if(options.lockRank){const bounds=[[16,32],[24,40],[44,54],[48,58],[32,32]][targeted?setup.difficulty:u8(0x576f)];if(bounds)w8(0x5770,Math.max(bounds[0],Math.min(bounds[1],setup.rank)));}
  }
  function active(){
    const b=u16(0xc672),m=u16(0xc4ae);
    if(b&&b!==0x1930&&u8(0x5ac9)<253&&i16(0x5ac6)>0)return 'boss';
    if(m&&m!==0x1930&&u8(0x5ab5)<254&&i16(0x5ab2)>0)return 'mid';return null;
  }
  function timeLock(){
    const s=u8(0x576e),p=u8(0x5ac9),type=active();if(!type)return;
    let cap=fixed[s]?.[p],limit=cycles[s]?.[p],frame=0x5aca,count=0x5acf;
    if(s===3&&type==='boss'){
      if(u16(0xc672)===0x3795){cap={7:2000}[p];limit={3:12,5:24,9:36}[p];}
      if(u16(0xc672)===0x42bb){cap={5:5000}[p];limit={3:36,7:36,9:20}[p];}
    }
    if(type==='mid'){cap=midFixed[s]?.[u8(0x5ab5)];limit=u8(0x5ab5)===1?midCycles[s]:0;frame=0x5ab6;count=s===6?0xc690:0xc68f;}
    // Recycle the completed attack/last loop, keeping the attack frame running.
    if(cap&&i16(frame)>=cap-2)w16(frame,0);
    if(limit&&u8(count)>=limit-1)w8(count,Math.max(0,limit-2));
  }
  function prepare(){
    if(ready)return;
    prepareFrames++;
    if(prepareFrames>40000){error='练习入口准备超时，请重试或从关卡开头开始';preparing=false;clock?.setSpeed(options.speed);onState(status());return;}
    if(!warped){
      warped=true;h()[csBase+patch.practice.entries.clearOverlay]=1;
      // Stage resources and TX2 scripts are now loaded. Start the requested
      // native entry without executing earlier enemy scripts or waiting for scroll.
      w16(0x4abe,u16(0x4ac0)); // remove the stage title overlay
      if(setup.entry==='boss'){
        w8(0x3515,0); // std_update enters the original resource-loading dialog
        w8(0x4ad6,1);
        v().setUint32(d+0x3f8e,v().getUint32(d+0xc672,true),true); // null stage VM
        v().setUint32(d+0xc4ae,v().getUint32(d+0xc672,true),true); // no midboss
        w8(0x5ab5,255);w16(0x5ab2,0);
      }else if(setup.entry==='mid'){
        const frame=u16(0x5ab0),segment=u16(0x366c);let ip=u16(0x366a);
        // STD records: u16 frame, u8 count, count * 8-byte enemy spawns.
        const script=base+segment*16;let n=0;
        while(n++<4096&&script+ip+3<h().length){const when=v().getUint16(script+ip,true);if(!when||when>=frame)break;ip+=3+h()[script+ip+2]*8;if(ip>65535)throw Error('练习 STD 游标越界');}
        w16(0x366a,ip);w16(0x5764,frame);
      }
    }
    const type=active(),target=setup.entry,phase=type==='mid'?u8(0x5ab5):u8(0x5ac9);
    let reached=target==='stage'||type===target&&(setup.phase?phase===setup.phase:phase>=(type==='boss'?2:setup.stage===0?3:1));
    if(setup.stage===3&&target==='boss'&&setup.branch!=='auto')reached=reached&&u16(0xc672)===(setup.branch==='mai'?0x42bb:0x3795);
    if(reached){
      ready=true;preparing=false;waiting=true;h()[csBase+patch.practice.entries.entryPause]=1;resources();w8(0x36f3,0);w8(0x36f4,0);w8(0x36ef,0);w8(0x36ee,0);w8(0x41d5,32);
      if(type&&target!=='stage'){
        const bounds=type==='mid'?midHp[setup.stage]?.[phase]:setup.stage===3&&setup.branch!=='auto'?branchHp[setup.branch][phase]:bossHp[setup.stage]?.[phase];
        if(bounds){const [max,min]=bounds;w16(type==='mid'?0x5ab2:0x5ac6,setup.hp?Math.max(min+1,Math.min(setup.hp,max)):max);}
      }
      elapsed=phaseFrames=0;capture();clock?.setSpeed(options.speed);onState(status());return;
    }
    w8(0x36ee,2);w8(0x36f3,0);resources();
    // Advance unwanted attacks through the original HP transition path.
    if(type==='mid'&&target==='boss')w16(0x5ab2,0);
    else if(type==='mid'&&target==='mid'&&setup.phase>phase){const bounds=midHp[setup.stage]?.[phase];if(bounds)w16(0x5ab2,Math.max(1,bounds[1]-1));}
    if(type==='boss'&&phase>=2){
      if(setup.stage===3&&u16(0xc672)!==0x42bb&&u16(0xc672)!==0x3795&&setup.branch!=='auto'){
        if(setup.branch==='mai')w16(0x5ade,0);else w16(0x5ac6,0);
      }else if(setup.phase>phase)w16(0x5ac6,Math.max(1,i16(0x5ad0)-1));
    }
  }
  function capture(){snapshot={stage:u8(0x576e),difficulty:u8(0x576f),rank:u8(0x5770),phase:u8(0x5ac9),midPhase:u8(0x5ab5),bossHp:i16(0x5ac6),midHp:i16(0x5ab2),phaseFrame:u16(0x5aca),phaseEndHp:i16(0x5ad0),midFrame:u16(0x5ab6),bossUpdate:u16(0xc672),midUpdate:u16(0xc4ae),lives:u8(0x4ad4)-1,bombs:u8(0x4ad5),power:u8(0x36f0),dream:u8(0x36f6),keys:u16(0x3064),focus:!!u8(0x3066),playerHit:!!u8(0x36f3),invincibility:u8(0x36ee),missTimer:u8(0x36f4),bombActive:!!u8(0x4206)};}
  function completed(){
    const stage=u8(0x576e),type=active(),phase=setup.entry==='mid'?u8(0x5ab5):u8(0x5ac9);
    if(type==='boss'&&phase>=2)observedBoss=true;
    if(stage!==setup.stage||u8(0x576c)===2)return true;
    if(setup.entry==='stage')return observedBoss&&u8(0x5ac9)>=253;
    // A selected attack ends on its native phase transition, including survival
    // timeouts. HP alone is insufficient (four-stage dual bosses have two HPs).
    if(setup.phase)return phase!==setup.phase;
    return phase>=(setup.entry==='mid'?254:253);
  }
  function status(){return {...snapshot,mode:normalized.mode,enabled:true,ready,preparing,waiting,outcome,frames,elapsed,phaseFrames,misses,bombsUsed,error,options:{...options},setup:{...setup}};}
  const api={
    configure(value){validatePracticeOptions(value,true);if('lockPower' in value&&value.lockPower!==options.lockPower)lockedPower=value.lockPower&&ready?u8(0x36f0):null;options={...options,...value,...PRACTICE_FIXED_OPTIONS};clock?.setSpeed(preparing&&prepareFrames?8:options.speed);},
    signal(port,packed){
      locate(packed);if(h()[resident+31])return; // no attract demos
      if(port===0x7ff0){
        if(targeted){h()[resident+17]=setup.difficulty;h()[resident+20]=setup.character;
        // Original MAIN only initializes the player/assets on stage 0/Extra.
        // Its built-in debug entry performs that initialization first, then
        // selects the desired stage before loading that stage's resources.
        h()[resident+19]=setup.stage===6?6:0;
        h()[resident+23]=setup.stage>0&&setup.stage<6?1:0;
        h()[resident+24]=setup.stage;h()[resident+25]=setup.power;
        h()[resident+13]=setup.lives+1;h()[resident+14]=setup.bombs;}
        h()[csBase+patch.practice.entries.targetPractice]=targeted?1:0;lockedPower=null;
        lastNativeBombs=h()[resident+28];misses=bombsUsed=lastMiss=0;initialized=true;initialPending=true;ready=false;preparing=targeted;prepareFrames=0;warped=false;outcome=null;observedBoss=false;waiting=false;h()[csBase+patch.practice.entries.entryPause]=0;return;
      }
      if(!initialized||u8(0x576c)>2||u8(0x576c)===1&&port!==0x7ff3&&port!==0x7ff4)return;
      if(port===0x7ff1){
        frames++;if(initialPending){if(targeted)resources();else{ready=true;lastNativeBombs=h()[resident+28];}initialPending=false;}
        if(preparing){if(!prepareFrames&&setup.entry!=='stage')clock?.setSpeed(8);prepare();}
        if(ready&&!waiting&&!outcome){elapsed++;const key=[u8(0x576e),active(),u8(0x5ac9),u8(0x5ab5),u16(0xc672)].join(':');if(key!==phaseKey){phaseKey=key;phaseFrames=0;}phaseFrames++;}
        if(options.lockTime&&ready)timeLock();
        let keys=u16(0x3064);
        if(preparing||outcome)keys=0;
        if(options.disableBomb)keys&=~16;if(options.disableShot)keys&=~32;
        w16(0x3064,keys);
        if(options.disableFocus)w8(0x3066,0);else if(options.forceFocus)w8(0x3066,1);
        if(preparing||outcome){w8(0x36ee,2);w8(0x36f3,0);}
        locks();
        if(options.autoBomb&&!options.disableBomb&&ready&&u8(0x36f3)&&!u8(0x36ee)&&u8(0x4ad5)&&!u8(0x4206))w16(0x3064,u16(0x3064)|16);
        h()[csBase+patch.practice.entries.enemyLock]=options.enemyInvincible&&ready?1:0;
        h()[csBase+patch.practice.entries.lockLives]=options.lockLives&&ready?1:0;
        h()[csBase+patch.practice.entries.unlimitedBombs]=options.lockBombs&&ready?1:0;
      }
      if(port===0x7ff2){
        waiting=false;
        // The native collision callbacks already remove the colliding bullet.
        // Consume only the hit flag, before native player_update starts death.
        if(ready&&!outcome&&options.invincible&&u8(0x36f3)&&!u8(0x36ee)&&!u8(0x36f4)){
          misses++;w8(0x36f3,0);
        }
        locks();
      }
      if(port===0x7ff3){
        const miss=u8(0x36f4),hit=miss&&!lastMiss&&ready&&!outcome,failed=hit&&targeted&&!options.lockLives;
        if(hit)misses++;if(failed)outcome='failed';lastMiss=miss;
        locks();
        if(failed){capture();onComplete(status());}
      }
      if(port===0x7ff4){
        const nativeBombs=h()[resident+28];if(ready&&!outcome)bombsUsed+=(nativeBombs-lastNativeBombs)&255;lastNativeBombs=nativeBombs;
        capture();
        if(targeted&&ready&&!outcome&&completed()){outcome='clear';onComplete(status());}
      }
    },
    get status(){return status();},get options(){return {...options};},
    get debug(){return {base,d,csBase,resident,initialized,prepareFrames,quit:d<0?null:u8(0x576c),residentBytes:resident<0?null:Array.from(h().subarray(resident,resident+40)),code:csBase<0?null:Array.from(h().subarray(csBase+patch.practice.entries.load,csBase+patch.practice.entries.load+20))};},
  };return api;
}
