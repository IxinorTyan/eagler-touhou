export function lifeBonus(count,enabled=true){return enabled?Math.floor(count/2):0;}
export function lifeCompensationText(count,enabled=true){
  return enabled?`生命补偿：每人初始残机 +${lifeBonus(count)}`:'生命补偿：关闭';
}
export function mountLifeCompensation({remember=false,key='th01-life-compensation'}={}){
  const toggle=document.getElementById('life-compensation'),count=document.getElementById('count'),note=document.getElementById('life-compensation-note');
  if(remember)toggle.checked=localStorage.getItem(key)!=='0';
  const update=()=>{note.textContent=`${lifeCompensationText(Number(count.value),toggle.checked)} · 每 2 玉 +1；续关恢复补偿后的初始残机。`;};
  toggle.addEventListener('change',()=>{if(remember)localStorage.setItem(key,toggle.checked?'1':'0');update();});
  count.addEventListener('change',update);update();return update;
}
