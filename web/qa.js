// Optional localhost browser fixture (?qa=1). Drives real keys and the public
// skip button and the native test invincibility flag.
export function installQA(api){
  const area=document.createElement('div'),report=document.createElement('pre');
  area.className='toolbar';report.id='qa-report';report.textContent='浏览器实测准备就绪。';
  document.querySelector('details').before(area,report);
  const godLabel=document.createElement('label'),god=document.createElement('input');
  god.type='checkbox';god.id='qa-invincible';god.disabled=api.baseline;
  godLabel.style.cssText='display:flex;align-items:center;gap:8px;';
  godLabel.append(god,document.createTextNode('运行中切换无敌'));area.append(godLabel);
  god.onchange=()=>api.setInvincible(god.checked);
  const syncGod=()=>{god.checked=api.isInvincible();};
  document.getElementById('start').addEventListener('click',syncGod);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function waitFor(predicate,timeout=45000,confirmTransitions=false){
    const end=performance.now()+timeout;let lastConfirm=0;
    while(performance.now()<end){
      const state=api.state();if(predicate(state))return state;
      if(confirmTransitions&&[0,3].includes(state?.phase)&&performance.now()-lastConfirm>700){await tap('Enter');lastConfirm=performance.now();}
      await sleep(50);
    }
    throw Error('等待原作状态超时');
  }
  async function tap(code){api.key(code,true);await sleep(120);api.key(code,false);}
  function button(label,run){
    const b=document.createElement('button');b.textContent=label;area.append(b);
    b.onclick=async()=>{b.disabled=true;report.textContent='RUNNING: '+label;
      try{if(!api.emulator())throw Error('请先启动游戏');const result=await run();report.textContent=JSON.stringify({passed:true,test:label,...result});}
      catch(error){report.textContent=JSON.stringify({passed:false,test:label,error:error.message,state:api.state()});}
      finally{b.disabled=false;}
    };
  }
  button('测试：进入第一关',async()=>{
    const end=performance.now()+45000;
    while(performance.now()<end){
      const state=api.state();if(state?.phase===1||state?.phase===2)return {state};
      await tap('Enter');await sleep(380);
    }
    throw Error('未进入第一关');
  });
  button('测试：逐项性能检查',async()=>{
    if(!api.isInvincible())throw Error('请先开启测试无敌');
    const entered=await waitFor(state=>state&&[1,2].includes(state.phase),45000,true);
    if(entered.count!==8)throw Error('请设置 8 玉');
    if(entered.phase===1)await tap('KeyZ');
    await waitFor(state=>state?.phase===2);
    const results=[];
    for(const [name,codes] of [['静止',[]],['左右移动',['MOVE']],['原地 X',['KeyX']],['移动与 X',['MOVE','KeyX']],['移动与 Z/X',['MOVE','KeyZ','KeyX']]]){
      const samples=[],start=performance.now();let direction=null,activeMs=0,last=performance.now(),lastLaunch=0,lastConfirm=0,previousState=api.state();
      const before=api.state();
      for(const code of codes)if(code!=='MOVE')api.key(code,true);
      try{
        while(activeMs<8000){
          const now=performance.now(),seconds=(now-start)/1000,state=api.state();
          if(now-start>60000)throw Error('有效游戏时间不足，检查转场状态');
          if(state?.phase===2&&previousState?.phase===2&&state.stage===previousState.stage&&state.ticks>previousState.ticks)activeMs+=now-last;
          previousState=state;
          last=now;
          const next=codes.includes('MOVE')&&state?.phase===2?(Math.floor(seconds)%2?'ArrowRight':'ArrowLeft'):null;
          if(next!==direction){if(direction)api.key(direction,false);if(next)api.key(next,true);direction=next;}
          if([0,3].includes(state?.phase)&&now-lastConfirm>700){await tap('Enter');lastConfirm=now;}
          if(state?.phase===1&&now-lastLaunch>1000){await tap('KeyZ');lastLaunch=now;}
          const perf=JSON.parse(document.getElementById('runtime').dataset.performance||'null');
          samples.push({seconds,activeSeconds:activeMs/1000,stage:state?.stage,phase:state?.phase,collisions:state?.collisions,cardHits:state?.cardHits,activeItems:state?.activeItems,profile:state?.profile,...perf});
          await sleep(500);
        }
      }finally{if(direction)api.key(direction,false);for(const code of codes)if(code!=='MOVE')api.key(code,false);}
      const after=api.state();
      results.push({name,before,after,samples});
      report.textContent=JSON.stringify({running:true,test:'逐项性能检查',results});
    }
    return {profileLabels:['角色','掉落物','计时/Boss/其他','玉运动及玉间碰撞','弹丸','卡牌及障碍','玉绘制'],results};
  });
  button('测试：发射与帧率',async()=>{
    const before=api.state();if(!before)throw Error('需要进入关卡');
    if(before.phase===1)await tap('KeyZ');
    else if(before.phase===3)await tap('Enter');
    await waitFor(state=>state?.phase===2);
    await sleep(3000);
    const after=api.state();
    const performanceInfo=JSON.parse(document.getElementById('runtime').dataset.performance||'null');
    if(after?.phase!==2||!performanceInfo||performanceInfo.gameHz<35)throw Error('未取得连续运行的游戏帧率');
    return {before,after,performance:performanceInfo};
  });
  button('测试：人物连续帧',async()=>{
    if(!api.isInvincible())throw Error('请先开启测试无敌');
    const entered=await waitFor(s=>s&&[1,2].includes(s.phase));
    if(entered.phase===1)await tap('KeyZ');
    const symbols=await (await fetch('player-draw-symbols.json')).json();
    if(symbols.exe_sha256!==window.th01Lab.manifest.exe_sha256)throw Error('绘制符号与程序不一致');
    const module=api.emulator().module,results=[];let current;
    module.inspectPresented565=(pixels,pitch)=>{
      const state=api.state();if(!current||state?.phase!==2||pitch!==1280)return;
      const heap=module.HEAPU8,v=new DataView(heap.buffer),bridge=api.bridge();
      const at=name=>bridge+symbols.relative[name];
      const word=p=>v.getUint16(p,true),signed=p=>v.getInt16(p,true);
      if(heap[at('PLAYER_IS_HIT')])return;
      const kind=word(at('PLAYER_DRAW_KIND')),left=signed(at('PLAYER_DRAW_LEFT'))>>3<<3,top=signed(at('PLAYER_DRAW_TOP')),cel=word(at('PLAYER_DRAW_CEL'));
      const far=p=>symbols.ram_base+word(p)+word(p+2)*16;
      const balls=Array.from({length:word(at('ORB_COUNT'))},(_,i)=>{
        const p=at('ORBS')+i*62;return {x:signed(p),y:signed(p+4),portal:!!word(p+8)};
      });
      let width,height,alpha,planes;
      if(kind===1){const p=far(at('PTN_IMAGES')+Math.floor(cel/64)*4)+(cel%64)*640;width=32;height=32;alpha=p+512;planes=[p,p+128,p+256,p+384];}
      else if(kind===2||kind===3){const obj=at(kind===2?'PLAYER_48X48':'PLAYER_48X32');width=heap[obj]*8;height=word(obj+2);const p=obj+4+cel*20;planes=[0,4,8,12].map(o=>far(p+o));alpha=far(p+16);}
      else{current.untracked++;return;}
      let checked=0,mismatches=0;const palette=at('Z_PALETTES');
      current.kinds[kind]=(current.kinds[kind]||0)+1;
      const expectedImage=new ImageData(width,height),actualImage=new ImageData(width,height);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const xx=left+x,yy=top+y;if(xx<0||xx>=640||yy<0||yy>=400)continue;
        const p=y*(width/8)+(x>>3),bit=128>>(x&7);if(!(heap[alpha+p]&bit))continue;
        // New orbs legitimately cover the player; don't count their pixels.
        if(balls.some(b=>!b.portal&&xx>=(b.x>>3<<3)&&xx<(b.x>>3<<3)+32&&yy>=b.y&&yy<b.y+32))continue;
        let col=0;for(let i=0;i<4;i++)if(heap[planes[i]+p]&bit)col|=1<<i;
        const rgb=word(pixels+(yy*640+xx)*2),r=(rgb>>11)*255/31,g=((rgb>>5)&63)*255/63,b=(rgb&31)*255/31;
        const expected=[heap[palette+col*3]*17,heap[palette+col*3+1]*17,heap[palette+col*3+2]*17];
        const q=(y*width+x)*4;
        actualImage.data.set([r,g,b,255],q);expectedImage.data.set([...expected,255],q);
        if(Math.max(Math.abs(r-expected[0]),Math.abs(g-expected[1]),Math.abs(b-expected[2]))>20)mismatches++;
        checked++;
      }
      current.frames++;current.checked+=checked;current.mismatches+=mismatches;
      if(!current.stages.includes(state.stage))current.stages.push(state.stage);
      if(checked&&mismatches/checked>.1){current.badFrames++;if(current.examples.length<8)current.examples.push({kind,left,top,cel,checked,mismatches});}
      if(checked&&(!current.worst||mismatches/checked>current.worst.ratio||
          (mismatches/checked===current.worst.ratio&&kind>current.worst.kind))){
        const c=document.createElement('canvas');c.width=width*2;c.height=height;const ctx=c.getContext('2d');ctx.putImageData(actualImage,0,0);ctx.putImageData(expectedImage,width,0);
        current.worst={ratio:mismatches/checked,kind,cel,src:c.toDataURL()};
      }
    };
    try{
      for(const [name,codes] of [['静止',[]],['原地 X',['KeyX']],['左滑铲',['ArrowLeft','KeyX']],['右滑铲',['ArrowRight','KeyX']],['Z/X',['KeyZ','KeyX']]]){
        current={name,frames:0,checked:0,mismatches:0,badFrames:0,untracked:0,kinds:{},stages:[],examples:[]};
        for(const code of codes)if(code.startsWith('Arrow'))api.key(code,true);
        try{
          const end=performance.now()+45000;
          while(current.frames<180){
            if(performance.now()>end)throw Error('活动画面采样不足');
            const state=api.state();
            if(state?.phase===1){await tap('KeyZ');continue;}
            if([0,3].includes(state?.phase)){await tap('Enter');await sleep(380);continue;}
            if(state?.phase!==2){await sleep(50);continue;}
            for(const code of codes)if(!code.startsWith('Arrow'))api.key(code,true);
            await sleep(180);
            for(const code of codes)if(!code.startsWith('Arrow'))api.key(code,false);
            await sleep(420);
          }
        }finally{for(const code of codes)api.key(code,false);}
        results.push(current);report.textContent=JSON.stringify({running:true,results});
      }
    }finally{delete module.inspectPresented565;}
    document.getElementById('qa-player-frames')?.remove();
    const sheet=document.createElement('div');sheet.id='qa-player-frames';report.after(sheet);
    for(const result of results){const line=document.createElement('p'),img=document.createElement('img');line.textContent=result.name+'：最差帧，左实际 / 右动作原图';img.src=result.worst?.src||'';img.style.cssText='image-rendering:pixelated;width:192px';sheet.append(line,img);delete result.worst?.src;}
    return {passed:results.every(r=>r.frames>=180&&r.checked>0&&r.mismatches===0&&r.untracked===0),
      results,performance:JSON.parse(document.getElementById('runtime').dataset.performance||'null')};
  });
  button('测试：跳到第五关',async()=>{
    const stages=[];
    while(true){
      const before=await waitFor(state=>state&&[1,2].includes(state.phase),45000,true);
      if(before.stage>=5)return {stages,state:before};
      document.getElementById('skip').click();
      const after=await waitFor(state=>state&&state.stage===before.stage+1&&[1,2].includes(state.phase),45000,true);
      if(after.count!==before.count)throw Error('切换关卡丢失玉数');
      stages.push({from:before.stage,to:after.stage,count:after.count});
    }
  });
  button('测试：八玉压力 45 秒',async()=>{
    if(!api.isInvincible())throw Error('请先在开局调试设置中开启“测试无敌”，或勾选“运行中切换无敌”');
    const enterEnd=performance.now()+45000;
    let state=api.state();
    while(!state||![1,2].includes(state.phase)){
      if(performance.now()>enterEnd)throw Error('未进入八玉关卡');
      await tap('Enter');await sleep(380);state=api.state();
    }
    if(state.count!==8)throw Error('请重新设置为 8 玉');
    if(state.phase===1)await tap('KeyZ');
    await waitFor(value=>value?.phase===2);
    const samples=[],started=performance.now();
    let direction=null,lastSample=started-2000,lastLaunch=0,lastConfirm=0;
    api.key('KeyZ',true);api.key('KeyX',true);
    try{
      while(performance.now()-started<45000){
        const now=performance.now();
        state=api.state();
        const next=state?.phase===2?(Math.floor((now-started)/2000)%2?'ArrowRight':'ArrowLeft'):null;
        if(next!==direction){if(direction)api.key(direction,false);if(next)api.key(next,true);direction=next;}
        if(state&&state.count!==8)throw Error('运行中丢失八玉配置');
        // During a miss/continue/menu, release movement so the original YES
        // choice remains selected. Confirm through ordinary Enter input.
        if([0,3].includes(state?.phase)&&now-lastConfirm>700){await tap('Enter');lastConfirm=now;}
        if(state?.phase===1&&now-lastLaunch>500){api.key('KeyZ',false);await tap('KeyZ');api.key('KeyZ',true);lastLaunch=now;}
        if(now-lastSample>=2000){
          lastSample=now;
          const perf=JSON.parse(document.getElementById('runtime').dataset.performance||'null');
          samples.push({seconds:(now-started)/1000,stage:state?.stage,phase:state?.phase,count:state?.count,collisions:state?.collisions,armedPairs:state?.armedPairs,...perf});
        }
        await sleep(100);
      }
    }finally{
      if(direction)api.key(direction,false);
      api.key('KeyZ',false);api.key('KeyX',false);
    }
    const active=samples.filter(value=>value.phase===2&&value.gameHz>0);
    if(active.length<8)throw Error('有效游戏采样不足，请保持游戏运行后重试');
    const rates=active.map(value=>value.gameHz).sort((a,b)=>a-b);
    const displayRates=active.map(value=>value.presentationHz).filter(value=>value>0).sort((a,b)=>a-b);
    if(displayRates.length<8)throw Error('完整画面采样不足，请检查模拟器输出');
    return {durationSeconds:(performance.now()-started)/1000,activeSamples:active.length,
      medianGameHz:rates[Math.floor(rates.length/2)],minimumGameHz:rates[0],
      medianPresentationHz:displayRates[Math.floor(displayRates.length/2)],minimumPresentationHz:displayRates[0],
      meanSimulationMs:active.reduce((sum,value)=>sum+value.averageMs,0)/active.length,
      worstWindowP95Ms:Math.max(...active.map(value=>value.p95Ms)),samples,state:api.state()};
  });
}
