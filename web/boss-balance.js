// Presentation of the native integer damage rule in boss/damage.cpp.
const number=value=>Number(value.toFixed(3)).toString();
export function bossBalance(players,count){
  const playerFactor=(players+1)/2,orbFactor=(17+3*count)/20;
  const multiplier=(players+1)*(17+3*count)/40;
  return {playerFactor,orbFactor,multiplier,damage:1/multiplier};
}
export function bossBalanceText(players,count){
  const {multiplier,damage}=bossBalance(players,count);
  return `Boss 耐久约 ×${number(multiplier)} · 减伤 ${(100*(1-damage)).toFixed(1)}%`;
}
export function mountBossBalance({getSettings}){
  const players=document.getElementById('players'),count=document.getElementById('count');
  function update(){
    const settings=getSettings(),balance=bossBalance(settings.players,settings.count);
    document.getElementById('players-boss-note').textContent=`人数耐久系数 ×${number(balance.playerFactor)} · 每多 1 人 +50%`;
    document.getElementById('orbs-boss-note').textContent=`玉数耐久系数 ×${number(balance.orbFactor)} · 每多 1 玉 +15%`;
    document.getElementById('boss-balance-summary').textContent=`${bossBalanceText(settings.players,settings.count)} · 每次有效命中累计 ${(balance.damage*100).toFixed(1)}% 格伤害`;
  }
  for(const select of [players,count])select.addEventListener('change',update);
  update();
  return update;
}
