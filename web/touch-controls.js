// TH03/TH04 relative drag, pointer ownership, safe-area layout and per-orientation
// editor adapted to TH01's one-dimensional movement and separate native Bomb.
import {HorizontalTouchInput,TOUCH_BOMB} from './touch-input.js';
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const storageKey='th01.touch.layout.v1',preferenceKey='th01.touch.preferences.v1';
const definitions=[
  ['left',1,'←','左移'],['right',2,'→','右移'],['shot',4,'射击','Z · 开球'],
  ['deflect',8,'御币','X · 滑铲'],['bomb',TOUCH_BOMB,'Bomb','独立使用'],
  ['pause',128,'暂停','Esc'],['up',16,'↑','菜单'],['down',32,'↓','菜单'],['confirm',64,'确认','Enter'],
];
const defaults={
  portrait:{left:[.1,.79,.9],right:[.27,.79,.9],shot:[.86,.75,1],deflect:[.86,.49,1],bomb:[.68,.23,.9],pause:[.09,.11,.8],up:[.72,.38,.8],down:[.72,.64,.8],confirm:[.86,.86,.85]},
  landscape:{left:[.08,.84,1],right:[.19,.84,1],shot:[.91,.83,1],deflect:[.91,.60,1],bomb:[.78,.83,1],pause:[.07,.10,.8],up:[.75,.40,.85],down:[.75,.64,.85],confirm:[.89,.84,.9]},
};
const valid=p=>p&&[p.x,p.y,p.scale].every(Number.isFinite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&p.scale>=.6&&p.scale<=1.8;
const clone=value=>JSON.parse(JSON.stringify(value));
export function mountTouchControls({player,screen,canvas,toolbar,getContext,onChange=()=>{},onReset=()=>{},onGesture=()=>{},
  onSelectSlot=null,fullscreenButton=null}){
  player.classList.add('th01-touch-player');
  const model=new HorizontalTouchInput();
  let active=false,play=false,contextKey='',editing=false,orientation='',selected='shot',draft=null,layoutGesture=null,uiKey='';
  let enabled=matchMedia('(pointer:coarse)').matches,gain=150,slot=0,profiles={portrait:{},landscape:{}};
  try{
    const saved=JSON.parse(localStorage.getItem(preferenceKey));
    if(typeof saved?.enabled==='boolean')enabled=saved.enabled;
    if(Number.isFinite(saved?.gain))gain=clamp(saved.gain,100,300);
    const stored=JSON.parse(localStorage.getItem(storageKey));
    for(const direction of ['portrait','landscape'])for(const [name]of definitions)if(valid(stored?.[direction]?.[name]))profiles[direction][name]=stored[direction][name];
  }catch{}
  const surface=document.createElement('div');surface.className='th01-touch-surface';surface.setAttribute('aria-label','单指横向拖动移动');
  const hint=document.createElement('span');hint.className='th01-touch-hint';hint.textContent='横向拖动移动';
  screen.append(surface,hint);
  const buttons=new Map();
  for(const [name,bits,title,help]of definitions){
    const button=document.createElement('button');button.type='button';button.dataset.touchControl=name;button.dataset.touchBits=bits;
    button.setAttribute('aria-label',name==='bomb'?'使用 Bomb':title);
    button.innerHTML=`<strong>${title}</strong><small>${help}</small><i class="touch-resize" aria-hidden="true">↘</i>`;
    screen.append(button);buttons.set(name,button);
  }
  const switchButton=document.createElement('button');switchButton.type='button';switchButton.textContent='触屏操作';switchButton.className='touch-toggle';
  const layoutButton=document.createElement('button');layoutButton.type='button';layoutButton.textContent='按键与触控';layoutButton.className='touch-layout-open';
  toolbar.append(switchButton,layoutButton);
  const editor=document.createElement('section');editor.className='th01-touch-editor';editor.hidden=true;editor.setAttribute('aria-label','触屏布局设置');
  editor.innerHTML=`<header><strong>按键与触控</strong><span data-orientation></span></header><div class="touch-editor-body">
    <p>拖动按键移动，用右下角缩放。横竖屏分别保存。</p>
    <label>选中按键<select data-selected></select></label>
    <label>大小<input data-size type="range" min="0.6" max="1.8" step="0.05"><output data-size-output></output></label>
    <label>拖动灵敏度<input data-gain type="range" min="100" max="300" step="10"><output data-gain-output></output></label>
    <label data-slot-label hidden>控制玩家<select data-slot><option value="0">P1</option><option value="1">P2</option><option value="2">P3</option></select></label>
    <p data-editor-note role="status">请先暂停游戏再调整布局。</p></div>
    <footer><button type="button" data-reset>恢复默认</button><button type="button" data-cancel>取消</button><button type="button" data-save>保存</button></footer>`;
  player.append(editor);
  const field=name=>editor.querySelector(`[data-${name}]`);
  for(const [name,,title]of definitions)field('selected').add(new Option(title,name));
  field('gain').value=gain;field('gain-output').textContent=`${gain}%`;
  function savePreferences(){try{localStorage.setItem(preferenceKey,JSON.stringify({enabled,gain}));}catch{}}
  function reset(){model.reset();for(const button of buttons.values())button.classList.remove('pressed');onReset();onChange();}
  function gesture(){canvas.focus({preventScroll:true});try{Promise.resolve(onGesture()).catch(()=>{});}catch{}}
  function place(){
    const r=screen.getBoundingClientRect();if(!r.width||!r.height)return;
    // Match the device viewport, independently of the game's fixed 8:5 canvas.
    const next=innerWidth>=innerHeight?'landscape':'portrait';
    if(next!==orientation){orientation=next;layoutGesture=null;reset();}
    field('orientation').textContent=orientation==='portrait'?'竖屏':'横屏';
    const profile=(editing?draft:profiles)[orientation];
    for(const [name,button]of buttons){
      const [x,y,scale]=defaults[orientation][name],p=profile[name]||{x,y,scale};
      const marginX=Math.min(.48,(button.offsetWidth*p.scale/2+10)/r.width),marginY=Math.min(.48,(button.offsetHeight*p.scale/2+10)/r.height);
      button.style.left=`${clamp(p.x,marginX,1-marginX)*100}%`;button.style.top=`${clamp(p.y,marginY,1-marginY)*100}%`;
      button.style.setProperty('--touch-scale',p.scale);button.classList.toggle('touch-selected',editing&&name===selected);
    }
    const p=profile[selected],scale=p?.scale??defaults[orientation][selected][2];
    field('selected').value=selected;field('size').value=scale;field('size-output').textContent=`${Math.round(scale*100)}%`;
  }
  function refresh(){
    const context=getContext()||{};
    if(context.key!==contextKey||!!context.active!==active){contextKey=context.key;active=!!context.active;reset();}
    play=!!context.play;slot=context.slot??slot;
    const nextUiKey=[enabled,active,play,editing,slot,context.localCoop,context.players,context.canMenu,context.ghost,context.phase,context.bombs].join(':');
    if(nextUiKey===uiKey)return context;uiKey=nextUiKey;
    player.classList.toggle('touch-enabled',enabled);player.classList.toggle('touch-gameplay',play);player.classList.toggle('touch-editing',editing);
    switchButton.setAttribute('aria-pressed',String(enabled));surface.hidden=!enabled||!active||!play||editing;
    hint.hidden=!enabled||!active||!play||editing;
    field('slot-label').hidden=!onSelectSlot||!context.localCoop;field('slot').value=String(slot);
    field('slot').options[2].hidden=context.players!==3;field('slot').options[2].disabled=context.players!==3;
    for(const [name,button]of buttons){
      const menu=['up','down','confirm'].includes(name);
      button.hidden=!enabled||(!editing&&(menu?play:!play&&['shot','deflect','bomb'].includes(name)));
      button.disabled=!editing&&(!active||(menu&&!context.canMenu)||
        (['shot','deflect','bomb'].includes(name)&&play&&context.ghost)||
        (name==='bomb'&&(!play||context.phase!==2||context.bombs===0)));
    }
    buttons.get('bomb').querySelector('small').textContent=Number.isInteger(context.bombs)?`剩余 ${context.bombs}`:'独立使用';
    return context;
  }
  function open(){enabled=true;savePreferences();reset();draft=clone(profiles);editing=true;editor.hidden=false;refresh();place();}
  function close(){editing=false;draft=null;layoutGesture=null;editor.hidden=true;reset();refresh();place();}
  switchButton.onclick=()=>{enabled=!enabled;savePreferences();if(!enabled&&editing)close();reset();refresh();place();};
  layoutButton.onclick=()=>editing?close():open();
  field('cancel').onclick=close;
  field('save').onclick=()=>{profiles=clone(draft);try{localStorage.setItem(storageKey,JSON.stringify(profiles));}catch{}close();};
  field('reset').onclick=()=>{draft[orientation]={};place();};
  field('selected').onchange=()=>{selected=field('selected').value;place();};
  function placement(name){const d=defaults[orientation][name];return {...((editing?draft:profiles)[orientation][name]||{x:d[0],y:d[1],scale:d[2]})};}
  field('size').oninput=()=>{draft[orientation][selected]={...placement(selected),scale:Number(field('size').value)};place();};
  field('gain').oninput=()=>{gain=Number(field('gain').value);field('gain-output').textContent=`${gain}%`;savePreferences();reset();};
  field('slot').onchange=()=>{const nextSlot=Number(field('slot').value);reset();onSelectSlot?.(nextSlot);refresh();};
  const capture=(node,event)=>{try{node.setPointerCapture(event.pointerId);}catch{}};
  for(const [name,bits]of definitions){
    const button=buttons.get(name);
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();event.stopPropagation();refresh();
      if(editing){
        selected=name;const p=placement(name);draft[orientation][name]=p;
        layoutGesture={id:event.pointerId,name,x:event.clientX,y:event.clientY,p,resize:!!event.target.closest('.touch-resize')};capture(button,event);place();return;
      }
      if(!active||!enabled||button.disabled)return;
      gesture();capture(button,event);model.press(event.pointerId,bits,{pulseOnly:name==='bomb'});button.classList.add('pressed');onChange();
    });
    button.addEventListener('pointermove',event=>{
      const g=layoutGesture;if(!editing||g?.id!==event.pointerId)return;
      event.preventDefault();const r=screen.getBoundingClientRect();
      draft[orientation][g.name]=g.resize?{...g.p,scale:clamp(g.p.scale+(event.clientX-g.x)/100,.6,1.8)}:
        {...g.p,x:clamp(g.p.x+(event.clientX-g.x)/r.width,0,1),y:clamp(g.p.y+(event.clientY-g.y)/r.height,0,1)};place();
    });
    const release=event=>{
      if(layoutGesture?.id===event.pointerId)layoutGesture=null;
      model.end(event.pointerId);
      if(!model.held.size)for(const b of buttons.values())b.classList.remove('pressed');
      else if(![...model.held.values()].some(v=>v&bits))button.classList.remove('pressed');
      onChange();
    };
    button.addEventListener('pointerup',release);button.addEventListener('lostpointercapture',release);
    button.addEventListener('pointercancel',release);
    button.addEventListener('click',event=>{
      event.preventDefault();
      if(event.detail===0&&!editing&&enabled&&active&&!button.disabled){model.pulses|=bits;gesture();onChange();}
    });
  }
  surface.addEventListener('pointerdown',event=>{
    const context=refresh();if(!enabled||!active||!play||editing||event.button!==0)return;
    event.preventDefault();gesture();
    const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/640,r.height/400);
    if(model.start(event.pointerId,event.clientX,context.left,scale,gain/100)){capture(surface,event);onChange();}
  });
  surface.addEventListener('pointermove',event=>{if(model.drag?.id!==event.pointerId)return;event.preventDefault();model.move(event.pointerId,event.clientX);onChange();});
  const end=event=>{model.end(event.pointerId);onChange();};
  surface.addEventListener('pointerup',end);surface.addEventListener('lostpointercapture',end);
  surface.addEventListener('pointercancel',end);
  screen.addEventListener('contextmenu',event=>{if(event.target.closest('.th01-touch-surface,[data-touch-control]'))event.preventDefault();});
  addEventListener('blur',reset);addEventListener('pagehide',reset);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
  const resize=()=>{reset();place();};new ResizeObserver(resize).observe(screen);
  addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
  let immersive=false,nativeFullscreen=false;
  async function exitFullscreen(){
    immersive=false;nativeFullscreen=false;player.classList.remove('th01-immersive');document.documentElement.classList.remove('th01-immersive-page');
    if(fullscreenButton)fullscreenButton.textContent='全屏';reset();
    if(document.fullscreenElement===player)try{await document.exitFullscreen();}catch{}
    resize();
  }
  if(fullscreenButton)fullscreenButton.onclick=async()=>{
    if(immersive){await exitFullscreen();return;}
    immersive=true;player.classList.add('th01-immersive');document.documentElement.classList.add('th01-immersive-page');
    fullscreenButton.textContent='退出全屏';reset();gesture();
    // Request from the button gesture on desktop and touch devices alike.
    // If the browser refuses (including insecure LAN), keep the page fallback.
    try{if(player.requestFullscreen){await player.requestFullscreen({navigationUI:'hide'});nativeFullscreen=document.fullscreenElement===player;}}catch{}
    resize();
  };
  document.addEventListener('fullscreenchange',()=>{
    if(document.fullscreenElement===player){nativeFullscreen=true;resize();}
    else if(nativeFullscreen&&immersive)exitFullscreen();
  });
  refresh();place();
  return {sample(){const context=refresh();if(!enabled||!active||editing||document.hidden)return 0;return model.sample(context.left,{play,ghost:context.ghost});},
    refresh,reset,open,close,exitFullscreen,isEditing:()=>editing,isEnabled:()=>enabled};
}
