// Guest CPU budget, selected before startup. This is separate from game ticks.
export function clockMultiplier(value) {
  const n=Number(value);
  if(![16,32].includes(n))throw Error('无效的模拟算力设置');
  return n;
}
export function mountCpuBudget(host,profile) {
  const label=document.createElement('label');label.textContent='模拟算力 ';
  const select=document.createElement('select');select.id='cpu-budget';
  for(const [value,text]of [[16,'标准'],[32,'增强（减少慢动作）']]){
    const option=document.createElement('option');option.value=String(value);option.textContent=text;select.append(option);
  }
  const key=`pc98-cpu-budget-${profile}-v1`;
  try{const saved=localStorage.getItem(key);if(saved!==null)select.value=String(clockMultiplier(saved));}catch{}
  select.onchange=()=>{try{localStorage.setItem(key,String(clockMultiplier(select.value)));}catch{}};
  const help=document.createElement('small');help.textContent='增强可减少原机算力不足的慢动作，但更耗设备性能；原作 Slow 设置仍生效。设备更卡时请选标准，修改后重新开局。';
  label.append(select);host.append(label,help);
  return select;
}
