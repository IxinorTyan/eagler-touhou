// Preserve explicit local-runtime diagnostic links used before the launcher.
if(new URLSearchParams(location.search).has('qa'))location.replace('local.html'+location.search+location.hash);
