// Per-seat preferences; the native game applies movement and draws markers.
export function mountFocusSettings(onChange){
  const controls=[1,2,3].map(id=>({enabled:document.getElementById('focus-enabled-'+id),
    percent:document.getElementById('focus-percent-'+id),output:document.getElementById('focus-output-'+id),
    point:document.getElementById('point-mode-'+id)}));
  const key='th02.local.focus-settings.v1';
  const targeting=document.getElementById('team-targeting');
  const clamp=value=>Math.max(10,Math.min(100,Math.round((Number(value)||50)/5)*5));
  try{
    const saved=JSON.parse(localStorage.getItem(key));
    targeting.checked=saved?.targeting!==false;
    controls.forEach((c,i)=>{const s=(saved?.seats||saved)?.[i];if(!s)return;
      c.enabled.checked=s.enabled!==false;c.percent.value=clamp(s.percent);
      if(['off','focus','always'].includes(s.point))c.point.value=s.point;
    });
  }catch{}
  const values=()=>controls.map(c=>({enabled:c.enabled.checked,percent:clamp(c.percent.value),point:c.point.value}));
  const show=()=>{for(const c of controls){c.output.value=clamp(c.percent.value)+'%';c.percent.disabled=!c.enabled.checked;}};
  const change=()=>{show();try{localStorage.setItem(key,JSON.stringify({seats:values(),targeting:targeting.checked}));}catch{}onChange();};
  targeting.addEventListener('change',change);
  for(const c of controls){c.enabled.addEventListener('change',change);c.percent.addEventListener('input',change);c.point.addEventListener('change',change);}
  show();
  return ()=>{const seats=values();return {seats,targeting:targeting.checked,enabledMask:seats.reduce((m,s,i)=>m|(s.enabled?1<<i:0),0),
    pointMask:seats.reduce((m,s,i)=>m|(s.point==='always'?8<<i:s.point==='focus'?1<<i:0),0)};};
}
