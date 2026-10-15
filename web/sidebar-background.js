/* The native HUD clears graphics to its darkest palette entry. Some stages
 * (Extra: palette 1 = 17,0,0) have no true black; transparent TRAM then exposes
 * that shade. Normalize only the dedicated HUD strip, never the playfield or
 * the offscreen tile cache. DOSBox-X expands 4-bit components as n<<4 (15=255).
 */
globalThis.sidebarBackground = function sidebarBackground(palette) {
  let index=0,minimum=Infinity;
  for(let i=0;i<16;i++){
    const sum=palette[i*3]+palette[i*3+1]+palette[i*3+2];
    if(sum<minimum){minimum=sum;index=i;}
  }
  return Array.from(palette.subarray(index*3,index*3+3),value=>{
    const nibble=value>>4;return nibble===15?255:nibble<<4;
  });
};
// Independent expected-output oracle for explicit QA; production uses GPU
// uniforms, without copying or editing the core's RGB framebuffer.
globalThis.normalizeSidebarRgb = function normalizeSidebarRgb(rgb,width,height,color) {
  if(!color||width!==640||height!==400)return 0;
  let changed=0;
  for(let y=0;y<height;y++)for(let x=448;x<576;x++){
    const at=(y*width+x)*3;
    if(rgb[at]<=color[0]&&rgb[at+1]<=color[1]&&rgb[at+2]<=color[2]){
      if(rgb[at]||rgb[at+1]||rgb[at+2])changed++;
      rgb[at]=rgb[at+1]=rgb[at+2]=0;
    }
  }
  return changed;
};
