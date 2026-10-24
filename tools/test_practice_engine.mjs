import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPracticeEngine} from '../web/practice-engine.js';
import {PRACTICE_DEFAULTS,PRACTICE_SETUP,PRACTICE_VERSION,normalizePractice,createPracticeClock} from '../web/practice-config.js';
const patch=JSON.parse(fs.readFileSync(new URL('../web/practice-assets.json',import.meta.url))).languages.jp.patch;
const entries=patch.practice.entries,cs=0x1aaf,ds=0x4000,base=0x10000,cb=base+cs*16,d=base+ds*16,r=base+0x90000;
let checks=0;
function instance(mode='target',setup={},options={}){
  const mod={HEAPU8:new Uint8Array(0x120000)},h=mod.HEAPU8,v=new DataView(h.buffer);
  h.set(new TextEncoder().encode(patch.signature),cb+patch.mailbox_cs_offset);h.set(new TextEncoder().encode('HUMAConfig\0'),r);
  v.setUint16(d+0xba86,0,true);v.setUint16(d+0xba88,0x9000,true);v.setUint16(d+0xbcd0,0x11c0,true);v.setUint16(d+0x46b6,0x11c0,true);
  h[r+11]=4;h[r+13]=3;h[d+0x4664]=1;
  h[d+0x4676]=7;v.setUint16(d+0xbccc,1280,true);
  const config=normalizePractice({version:PRACTICE_VERSION,mode,setup:{...PRACTICE_SETUP,...setup},options:{...PRACTICE_DEFAULTS,...options}}),clock={speed:1,setSpeed(s){this.speed=s;}};
  const engine=createPracticeEngine({mod,patch,config,clock}),signal=port=>engine.signal(port,ds<<16|cs),b=(at,n)=>{h[d+at]=n;},w=(at,n)=>v.setUint16(d+at,n&65535,true);
  return {mod,h,v,engine,signal,b,w,clock};
}
{
  const t=instance('full',{stage:5,power:128,rank:24});t.signal(0x7fe0);t.signal(0x7fe1);
  assert.equal(t.h[r+11],4);assert.equal(t.h[r+13],3);assert.equal(t.engine.status.power,1);assert.equal(t.engine.status.stage,0);checks++;
  assert.equal(t.engine.status.dream,12800);assert.equal(t.engine.status.dreamItems,7);assert.equal(t.h[cb+entries.resourceDirty],0);checks++;
  t.b(0x4669,1);t.signal(0x7fe4);assert.equal(t.engine.status.misses,1);t.signal(0x7fe2);assert.equal(t.engine.status.misses,1);checks++;
}
{
  const t=instance();t.signal(0x7fe0);t.signal(0x7fe1);
  assert(t.engine.status.ready&&t.engine.status.waiting);assert.equal(t.h[cb+entries.entryPause],1);assert.equal(t.h[r+11],1);assert.equal(t.h[r+13],0);
  assert.equal(t.engine.status.invincibility,0);assert.equal(t.engine.status.power,128);checks++;
  assert.equal(t.engine.status.dream,0);assert.equal(t.engine.status.dreamItems,0);assert.equal(t.h[cb+entries.resourceDirty],3);checks++;
  t.signal(0x7fe2);assert.equal(t.engine.status.waiting,false);
  t.engine.configure({invincible:true});t.b(0x4669,1);t.signal(0x7fe4);assert.equal(t.engine.status.misses,1);assert.equal(t.engine.status.playerHit,0);assert.equal(t.engine.status.invincibility,0);
  t.signal(0x7fe2);assert.equal(t.engine.status.misses,1);assert.equal(t.engine.status.outcome,null);checks++;
  t.engine.configure({lockPower:true});t.b(0x4664,64);t.signal(0x7fe3);assert.equal(t.engine.status.power,128);
  assert(t.h[cb+entries.resourceDirty]&1,'F4 must refresh the native shot function and HUD');
  t.engine.configure({lockPower:false});t.b(0x4664,64);t.signal(0x7fe3);assert.equal(t.engine.status.power,64);
  t.engine.configure({lockPower:true});t.b(0x4664,80);t.signal(0x7fe3);assert.equal(t.engine.status.power,64);checks++;
  t.engine.configure({lockBombs:true,lockLives:true,enemyInvincible:true});t.signal(0x7fe1);
  assert.equal(t.h[cb+entries.unlimitedBombs],1);assert.equal(t.h[cb+entries.lockLives],1);assert.equal(t.h[cb+entries.enemyLock],1);
  t.b(0x4664,16);t.engine.configure({lockPower:false});t.b(0x466a,20);t.signal(0x7fe3);assert.equal(t.engine.status.outcome,null);assert.equal(t.engine.status.power,16);checks++;
  t.h[r+50]=2;t.signal(0x7fe4);assert.equal(t.engine.status.bombsUsed,2);checks++;
}
for(const power of [1,16,64,128]){
  const t=instance('target',{entry:'boss',phase:2,power});t.signal(0x7fe0);t.signal(0x7fe1);
  assert.equal(t.engine.status.ready,false);assert.equal(t.engine.status.power,power);assert.equal(t.engine.status.dream,0);
  // A Dream pickup during the seek must not leak into the actual entry.
  t.b(0x4676,5);t.w(0xbccc,800);t.w(0xbcd0,0x6013);t.b(0x53d9,2);t.w(0x53d6,3050);t.signal(0x7fe1);
  assert(t.engine.status.ready);assert.equal(t.engine.status.power,power);assert.equal(t.engine.status.dream,0);assert.equal(t.engine.status.dreamItems,0);
  assert.equal(t.h[cb+entries.resourceDirty],3);
  t.b(0x4664,Math.min(128,power+1));t.b(0x4676,1);t.w(0xbccc,100);t.signal(0x7fe4);
  assert.equal(t.engine.status.power,Math.min(128,power+1));assert.equal(t.engine.status.dream,1000,'Dream must grow naturally after entry');checks++;
}
for(const invincible of [false,true]){
  const t=instance('target',{entry:'boss',phase:2},{invincible});t.signal(0x7fe0);t.w(0xbcd0,0x6013);t.b(0x53d9,2);t.w(0x53d6,3050);t.w(0x53e0,1950);t.signal(0x7fe1);t.signal(0x7fe2);
  t.b(0x4669,1);t.b(0x53d9,3);t.signal(0x7fe4);
  assert.equal(t.engine.status.outcome,invincible?'clear':'failed');assert.equal(t.engine.status.misses,1);assert.equal(t.h[cb+entries.hold],1);checks++;
}
// Fixed deadlines and actual native loop counters: attack frames continue.
for(const [stage,phase,counter,limit,frameCap]of [[0,2,0xbced,16,0],[1,2,0x53df,11,0],[2,3,0x53df,8,0],[3,2,0x53df,52,0],[4,2,0x53df,4,0],[5,14,0x53df,18,0],[6,2,0x46ae,36,0],[0,3,0,0,1501],[6,4,0,0,192]]){
  const t=instance('target',{stage,entry:'boss',phase},{lockTime:true});t.signal(0x7fe0);t.w(0xbcd0,0x6013);t.b(0x53d9,phase);t.w(0x53d6,3050);t.signal(0x7fe1);
  t.w(0x53da,frameCap?frameCap-1:57);if(counter)t.b(counter,limit-1);t.signal(0x7fe2);
  if(counter){assert.equal(t.h[d+counter],0);assert.equal(t.engine.status.phaseFrame,57);}else assert.equal(t.engine.status.phaseFrame,0);checks++;
}
{
  const t=instance('target',{entry:'mid'},{lockTime:true});t.signal(0x7fe0);t.w(0x46b6,0x6013);t.b(0x53c5,3);t.w(0x53c2,800);t.signal(0x7fe1);t.b(0x4277,4);t.signal(0x7fe2);
  assert.equal(t.h[d+0x4277],2);checks++;
}
{
  const t=instance('target',{stage:5,entry:'boss',phase:16});t.signal(0x7fe0);t.w(0xbcd0,0x6013);t.b(0x53d9,14);t.w(0x53d6,1200);t.w(0x53e0,0);t.signal(0x7fe1);
  assert.equal(t.engine.status.bossHp,0);t.b(0x53d9,16);t.signal(0x7fe1);assert(t.engine.status.ready);assert.equal(t.engine.status.bossHp,1200);checks++;
}
assert.throws(()=>normalizePractice({version:PRACTICE_VERSION,mode:'target',setup:{entry:'mid',stage:6}}));
{
  const t=instance('target',{entry:'boss'});t.signal(0x7fe0);t.signal(0x7fe1);
  t.w(0x538a,3100);t.w(0x53c0,3100);t.signal(0x7fe1);assert.equal(t.v.getUint16(d+0x53c0,true),3099);checks++;
  t.engine.observeBoundary();assert.equal(t.engine.status.error,null);
  t.mod._emGetRunningProgram=()=>1;t.mod.UTF8ToString=()=>'PMD86';t.engine.observeBoundary();
  assert.match(t.engine.status.error,/MAIN 已退出/);assert.equal(t.engine.status.preparing,false);checks++;
}
const clock=createPracticeClock(1),a=clock.now();clock.setSpeed(.5);assert(clock.now()>=a);assert.equal(clock.speed,.5);clock.setSpeed(2);assert.equal(clock.speed,2);assert.throws(()=>clock.setSpeed(0));checks++;
console.log(`PASS ${checks} TH04 engine checks: full/target isolation, stocks, hits, F1/F2/F4, bomb statistics, clear priority, native timers, final survival HP and clock`);
