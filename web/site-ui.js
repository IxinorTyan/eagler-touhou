// Shared launcher/navigation presentation. Gameplay and room ownership stay local.
const header=document.getElementById('site-header');
if(header){
  header.innerHTML='<header class="masthead"><a class="brand" href="index.html">TOUHOU / 01</a><small>東方靈異伝 · HIGHLY RESPONSIVE TO PRAYERS</small></header><nav class="mode-nav" aria-label="游戏模式"><a data-mode="solo" href="solo.html">单人游戏</a><a data-mode="local" href="local.html">本地合作</a><a id="lan-link" data-mode="lan" href="lan.html?network=lan">局域网联机</a><a id="public-link" data-mode="public" href="lan.html?network=public">公网联机</a></nav>';
  const mode=document.body.dataset.page;
  header.querySelector(`[data-mode="${mode}"]`)?.setAttribute('aria-current','page');
}
// Keep bookmarked diagnostics links from the former combined game homepage.
if(document.body.dataset.page==='home'){
  const params=new URLSearchParams(location.search);
  if(params.has('baseline')||params.has('qa'))location.replace(`${params.get('baseline')==='1'?'solo':'local'}.html${location.search}`);
}
