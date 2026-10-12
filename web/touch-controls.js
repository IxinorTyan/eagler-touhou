// TH03/TH04 pointer ownership, safe-area layout and per-orientation
// editor adapted to TH01's one-dimensional movement and separate native Bomb.
import {HorizontalTouchInput,TOUCH_BOMB} from './touch-input.js';
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const storageKey='th01.touch.layout.v2',preferenceKey='th01.touch.preferences.v1';
const definitions=[
  ['left',1,'←','左移'],['right',2,'→','右移'],['shot',4,'射击','Z · 开球'],
  ['deflect',8,'御币','X · 滑铲'],['bomb',TOUCH_BOMB,'Bomb','独立使用'],
  ['pause',128,'暂停','Esc'],['up',16,'↑','菜单'],['down',32,'↓','菜单'],['confirm',64,'确认','Enter'],
];
const defaults={
  portrait:{left:[.13,.86,1],right:[.35,.86,1],shot:[.86,.72,1],deflect:[.86,.54,1],bomb:[.65,.87,1],pause:[.08,.07,1],up:[.76,.38,.9],down:[.76,.66,.9],confirm:[.76,.84,1]},
  landscape:{left:[.08,.85,1],right:[.20,.85,1],shot:[.92,.80,1],deflect:[.92,.61,1],bomb:[.79,.85,1],pause:[.04,.07,1],up:[.86,.32,.9],down:[.86,.68,.9],confirm:[.86,.86,1]},
};
const valid=p=>p&&[p.x,p.y,p.scale].every(Number.isFinite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&p.scale>=.6&&p.scale<=1.8;
const clone=value=>JSON.parse(JSON.stringify(value));
export function mountTouchControls({player,screen,canvas,toolbar,getContext,onChange=()=>{},onReset=()=>{},onGesture=()=>{},
  onSelectSlot=null,fullscreenButton=null}){
  player.classList.add('th01-touch-player');
  const model=new HorizontalTouchInput();
  let active=false,play=false,recovering=false,recoveryStage=null,contextKey='',editing=false,orientation='',selected='shot',draft=null,layoutGesture=null,uiKey='';
  let enabled=matchMedia('(pointer:coarse)').matches,slot=0,profiles={portrait:{},landscape:{}},viewport={portrait:0,landscape:0},draftViewport=null,windows={};
  try{
    const saved=JSON.parse(localStorage.getItem(preferenceKey));
    if(typeof saved?.enabled==='boolean')enabled=saved.enabled;
    const stored=JSON.parse(localStorage.getItem(storageKey));
    for(const direction of ['portrait','landscape'])for(const [name]of definitions)if(valid(stored?.[direction]?.[name]))profiles[direction][name]=stored[direction][name];
    // The button layout has its own profile: old drag-mode action positions
    // may occupy the new direction pad and must not cover its buttons.
    const savedViewport=JSON.parse(localStorage.getItem('th01.touch.viewport.v1'));
    for(const direction of ['portrait','landscape'])if(Number.isFinite(savedViewport?.[direction]))viewport[direction]=clamp(savedViewport[direction],-.5,.5);
    windows=JSON.parse(localStorage.getItem('th01.touch.windows.v1'))||{};
  }catch{}
  const safe=document.createElement('div');safe.className='th01-touch-safe-zone';screen.append(safe);
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
  const overlayLayout=document.createElement('button');overlayLayout.type='button';overlayLayout.className='touch-help-open';overlayLayout.textContent='按键与触控';
  const overlayFull=document.createElement('button');overlayFull.type='button';overlayFull.className='touch-full-open';overlayFull.textContent='⛶';overlayFull.setAttribute('aria-label','进入全屏');
  screen.append(overlayLayout,overlayFull);
  const editor=document.createElement('section');editor.className='th01-touch-editor';editor.hidden=true;editor.setAttribute('aria-label','触屏布局设置');
  editor.innerHTML=`<header><strong>按键与触控</strong><span data-orientation></span><button type="button" data-collapse aria-label="收起面板" aria-expanded="true">⌃</button></header><div class="touch-editor-content"><div class="touch-editor-body">
    <p>拖动按键移动，用右下角缩放。横竖屏分别保存。</p>
    <label>选中按键<select data-selected></select></label>
    <label>大小<input data-size type="range" min="0.6" max="1.8" step="0.05"><output data-size-output></output></label>
    <div class="touch-editor-actions"><button type="button" data-back>移至底层</button><button type="button" data-front>移至顶层</button></div>
    <label class="touch-enable-option"><input data-enabled type="checkbox">启用触屏操作</label>
    <label>画面水平位置<input data-viewport type="range" min="-0.5" max="0.5" step="0.01"><button type="button" data-viewport-reset>复位</button></label>
    <label data-slot-label hidden>控制玩家<select data-slot><option value="0">P1</option><option value="1">P2</option><option value="2">P3</option></select></label>
    <div class="touch-system-settings"></div><p data-editor-note role="status">请先暂停游戏再调整布局。</p></div>
    <footer><button type="button" data-reset>恢复默认</button><button type="button" data-cancel>取消</button><button type="button" data-save>保存</button></footer></div>`;
  player.append(editor);
  const field=name=>editor.querySelector(`[data-${name}]`);
  for(const [name,,title]of definitions)field('selected').add(new Option(title,name));
  const chrome=[toolbar.closest('.toolbar'),player.querySelector('.music-controls')].filter(Boolean).map(node=>{
    const marker=document.createComment('fullscreen settings');node.before(marker);return {node,marker};
  });
  function moveChrome(full){for(const {node,marker}of chrome)if(full)editor.querySelector('.touch-system-settings').append(node);else marker.after(node);}
  function placePanel(){
    const r=player.getBoundingClientRect(),p=windows[orientation];
    const maxX=Math.max(0,r.width-editor.offsetWidth),maxY=Math.max(0,r.height-editor.offsetHeight);
    editor.style.left=`${clamp(Number.isFinite(p?.x)?p.x:.5,0,1)*maxX}px`;
    editor.style.top=`${clamp(Number.isFinite(p?.y)?p.y:0,0,1)*maxY}px`;
  }
  function savePreferences(){try{localStorage.setItem(preferenceKey,JSON.stringify({enabled}));}catch{}}
  function reset(){model.reset();for(const button of buttons.values())button.classList.remove('pressed');onReset();onChange();}
  function gesture(){canvas.focus({preventScroll:true});try{Promise.resolve(onGesture()).catch(()=>{});}catch{}}
  function place(){
    const s=screen.getBoundingClientRect(),r=safe.getBoundingClientRect();if(!r.width||!r.height)return;
    // Match the device viewport, independently of the game's fixed 8:5 canvas.
    const next=innerWidth>=innerHeight?'landscape':'portrait';
    if(next!==orientation){orientation=next;layoutGesture=null;reset();}
    field('orientation').textContent=orientation==='portrait'?'竖屏':'横屏';
    const profile=(editing?draft:profiles)[orientation];
    for(const [index,[name,button]]of [...buttons].entries()){
      const [x,y,scale]=defaults[orientation][name],p=profile[name]||{x,y,scale};
      const marginX=Math.min(.48,(button.offsetWidth*p.scale/2+10)/r.width),marginY=Math.min(.48,(button.offsetHeight*p.scale/2+10)/r.height);
      button.style.left=`${r.left-s.left+clamp(p.x,marginX,1-marginX)*r.width}px`;button.style.top=`${r.top-s.top+clamp(p.y,marginY,1-marginY)*r.height}px`;
      button.style.zIndex=String(6+clamp(Number.isFinite(p.priority)?p.priority:index,0,definitions.length-1));
      button.style.setProperty('--touch-scale',p.scale);button.classList.toggle('touch-selected',editing&&name===selected);
    }
    const p=profile[selected],scale=p?.scale??defaults[orientation][selected][2];
    field('selected').value=selected;field('size').value=scale;field('size-output').textContent=`${Math.round(scale*100)}%`;
    const offset=(editing?draftViewport:viewport)[orientation];field('viewport').value=offset;canvas.style.transform=`translateX(${offset*r.width}px)`;placePanel();
  }
  function refresh(){
    const context=getContext()||{};
    if(context.key!==contextKey||!!context.active!==active){contextKey=context.key;active=!!context.active;reset();}
    if(!active||context.play||context.phase===3||context.menu||recoveryStage!==context.stage){recovering=false;recoveryStage=null;}
    if(context.recovering){recovering=true;recoveryStage=context.stage;}
    play=!!context.play||recovering;slot=context.slot??slot;
    const nextUiKey=[enabled,active,play,recovering,editing,slot,context.localCoop,context.players,context.canMenu,context.ghost,context.phase,context.bombs].join(':');
    if(nextUiKey===uiKey)return context;uiKey=nextUiKey;
    player.classList.toggle('touch-enabled',enabled);player.classList.toggle('touch-gameplay',play);player.classList.toggle('touch-editing',editing);
    switchButton.setAttribute('aria-pressed',String(enabled));
    field('enabled').checked=enabled;
    field('slot-label').hidden=!onSelectSlot||!context.localCoop;field('slot').value=String(slot);
    field('slot').options[2].hidden=context.players!==3;field('slot').options[2].disabled=context.players!==3;
    for(const [name,button]of buttons){
      const menu=['up','down','confirm'].includes(name)||(!play&&['left','right'].includes(name));
      button.hidden=!editing&&((!enabled&&!(name==='pause'&&immersive))||(menu?play:!play&&['shot','deflect','bomb'].includes(name)));
      button.disabled=!editing&&(!active||recovering||(menu&&!context.canMenu)||
        (['shot','deflect','bomb'].includes(name)&&play&&context.ghost)||
        (name==='bomb'&&(!play||context.phase!==2||context.bombs===0)));
    }
    buttons.get('bomb').querySelector('small').textContent=Number.isInteger(context.bombs)?`剩余 ${context.bombs}`:'独立使用';
    place();
    return context;
  }
  function open(){reset();draft=clone(profiles);draftViewport={...viewport};editing=true;editor.hidden=false;refresh();place();}
  function close(){editing=false;draft=null;layoutGesture=null;editor.hidden=true;reset();refresh();place();}
  switchButton.onclick=()=>{enabled=!enabled;savePreferences();if(!enabled&&editing)close();reset();refresh();place();};
  layoutButton.onclick=overlayLayout.onclick=()=>editing?close():open();
  field('cancel').onclick=close;
  field('save').onclick=()=>{profiles=clone(draft);viewport={...draftViewport};try{localStorage.setItem(storageKey,JSON.stringify(profiles));localStorage.setItem('th01.touch.viewport.v1',JSON.stringify(viewport));}catch{}close();};
  field('reset').onclick=()=>{draft[orientation]={};draftViewport[orientation]=0;place();};
  field('selected').onchange=()=>{selected=field('selected').value;place();};
  function placement(name){const d=defaults[orientation][name];return {...((editing?draft:profiles)[orientation][name]||{x:d[0],y:d[1],scale:d[2]})};}
  field('size').oninput=()=>{draft[orientation][selected]={...placement(selected),scale:Number(field('size').value)};place();};
  field('enabled').onchange=()=>{enabled=field('enabled').checked;savePreferences();reset();refresh();place();};
  field('viewport').oninput=()=>{draftViewport[orientation]=Number(field('viewport').value);place();};
  field('viewport-reset').onclick=()=>{draftViewport[orientation]=0;place();};
  field('collapse').onclick=()=>{
    const content=editor.querySelector('.touch-editor-content');content.hidden=!content.hidden;
    field('collapse').setAttribute('aria-expanded',String(!content.hidden));field('collapse').setAttribute('aria-label',content.hidden?'展开面板':'收起面板');placePanel();
  };
  function reorder(front){
    const ordered=[...buttons.keys()].sort((a,b)=>(placement(a).priority??definitions.findIndex(d=>d[0]===a))-(placement(b).priority??definitions.findIndex(d=>d[0]===b))).filter(name=>name!==selected);
    front?ordered.push(selected):ordered.unshift(selected);
    ordered.forEach((name,priority)=>{draft[orientation][name]={...placement(name),priority};});place();
  }
  field('front').onclick=()=>reorder(true);field('back').onclick=()=>reorder(false);
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
      if(!active||(!enabled&&!(name==='pause'&&immersive))||button.disabled)return;
      gesture();capture(button,event);model.press(event.pointerId,bits,{pulseOnly:name==='bomb',menu:!play});button.classList.add('pressed');onChange();
    });
    button.addEventListener('pointermove',event=>{
      const g=layoutGesture;if(!editing||g?.id!==event.pointerId)return;
      event.preventDefault();const r=safe.getBoundingClientRect();
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
      if(event.detail===0&&!editing&&(enabled||name==='pause'&&immersive)&&active&&!button.disabled){model.pulses|=bits;gesture();onChange();}
    });
  }
  screen.addEventListener('contextmenu',event=>{if(event.target.closest('[data-touch-control]'))event.preventDefault();});
  addEventListener('blur',reset);addEventListener('pagehide',reset);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
  let panelDrag=null;
  const editorHeader=editor.querySelector('header');
  editorHeader.onpointerdown=event=>{
    if(event.target.closest('button')||event.button!==0)return;
    event.preventDefault();const r=editor.getBoundingClientRect(),p=player.getBoundingClientRect();
    panelDrag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left-p.left,top:r.top-p.top};capture(editorHeader,event);
  };
  editorHeader.onpointermove=event=>{
    if(panelDrag?.id!==event.pointerId)return;event.preventDefault();
    const r=player.getBoundingClientRect(),maxX=Math.max(0,r.width-editor.offsetWidth),maxY=Math.max(0,r.height-editor.offsetHeight);
    const x=clamp(panelDrag.left+event.clientX-panelDrag.x,0,maxX),y=clamp(panelDrag.top+event.clientY-panelDrag.y,0,maxY);
    windows[orientation]={x:maxX?x/maxX:0,y:maxY?y/maxY:0};placePanel();
  };
  editorHeader.onpointerup=editorHeader.onpointercancel=editorHeader.onlostpointercapture=()=>{
    panelDrag=null;try{localStorage.setItem('th01.touch.windows.v1',JSON.stringify(windows));}catch{}
  };
  const resize=()=>{reset();place();};new ResizeObserver(resize).observe(screen);
  new ResizeObserver(placePanel).observe(editor);
  addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
  let immersive=false,nativeFullscreen=false;
  async function exitFullscreen(){
    immersive=false;nativeFullscreen=false;player.classList.remove('th01-immersive');document.documentElement.classList.remove('th01-immersive-page');
    moveChrome(false);overlayFull.setAttribute('aria-label','进入全屏');
    if(fullscreenButton)fullscreenButton.textContent='全屏';reset();
    if((document.fullscreenElement||document.webkitFullscreenElement)===player)try{if(document.exitFullscreen)await document.exitFullscreen();else await document.webkitExitFullscreen?.();}catch{}
    uiKey='';refresh();resize();
  }
  if(fullscreenButton)fullscreenButton.onclick=async()=>{
    if(immersive){await exitFullscreen();return;}
    immersive=true;player.classList.add('th01-immersive');document.documentElement.classList.add('th01-immersive-page');
    moveChrome(true);overlayFull.setAttribute('aria-label','退出全屏');uiKey='';refresh();
    fullscreenButton.textContent='退出全屏';reset();gesture();
    // Request from the button gesture on desktop and touch devices alike.
    // If the browser refuses (including insecure LAN), keep the page fallback.
    try{if(player.requestFullscreen)await player.requestFullscreen({navigationUI:'hide'});else await player.webkitRequestFullscreen?.();nativeFullscreen=(document.fullscreenElement||document.webkitFullscreenElement)===player;}catch{}
    resize();
  };
  overlayFull.onclick=()=>fullscreenButton?.click();
  const fullscreenChanged=()=>{
    if((document.fullscreenElement||document.webkitFullscreenElement)===player){nativeFullscreen=true;resize();}
    else if(nativeFullscreen&&immersive)exitFullscreen();
  };
  document.addEventListener('fullscreenchange',fullscreenChanged);document.addEventListener('webkitfullscreenchange',fullscreenChanged);
  refresh();place();
  return {sample(){const context=refresh();if((!enabled&&!immersive)||!active||recovering||editing||document.hidden)return 0;return model.sample(context.left,{play,ghost:context.ghost});},
    refresh,reset,open,close,exitFullscreen,isEditing:()=>editing,isEnabled:()=>enabled};
}
