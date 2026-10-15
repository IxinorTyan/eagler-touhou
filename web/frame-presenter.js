/* PC-98 2D frames keep the original emulated timing. Local play draws each
 * RGB update; netplay can defer GPU submission to its accepted step boundary.
 * Worker GL calls alone do not guarantee placeholder canvas frame delivery.
 */
globalThis.installFramePresenter = function installFramePresenter(mod, mode = 'direct') {
  const gl = mod.gl;
  if (!gl || mod.glfx) throw Error('TH05 画面呈现需要 PC-98 2D WebGL 上下文');
  const metrics = {mode, updates:0,coalesced:0,submitted: 0, drawn: 0,transferred:0,backpressureDropped:0};
  const upstream = mod.updateTexture;
  if (mode === 'upstream') {
    mod.updateTexture = (...args) => { metrics.submitted++; upstream(...args); };
    return metrics;
  }
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, `
    attribute vec2 position; attribute vec2 uv;
    varying vec2 texcoord;
    void main(){ gl_Position=vec4(position,0.0,1.0); texcoord=uv; }`);
  const fs = shader(gl.FRAGMENT_SHADER, `
    precision mediump float; varying vec2 texcoord; uniform sampler2D image;
    uniform vec3 sidebarBlack; uniform bool normalizeSidebar;
    uniform vec2 hitpoint1; uniform vec2 hitpoint2; uniform vec2 hitpoint3; uniform vec2 frameSize;
    uniform sampler2D personalHud;
    void main(){
      vec3 rgb=texture2D(image,texcoord).rgb;
      if(normalizeSidebar && texcoord.x>=0.7 && texcoord.x<0.9 &&
        all(lessThanEqual(rgb,sidebarBlack+vec3(0.0001))))rgb=vec3(0.0);
      vec2 pixel=floor(texcoord*frameSize);
      vec2 d1=abs(pixel-hitpoint1),d2=abs(pixel-hitpoint2),d3=abs(pixel-hitpoint3);
      float pointDistance=min(min(max(d1.x,d1.y),max(d2.x,d2.y)),max(d3.x,d3.y));
      if(pixel.x>=32.0&&pixel.x<416.0&&pixel.y>=16.0&&pixel.y<384.0&&pointDistance<=2.0)
        rgb=pointDistance<=1.0?vec3(1.0):vec3(0.0);
      vec4 hud=vec4(0.0);
      if(frameSize.x==640.0&&frameSize.y==400.0){
        if(pixel.x>=448.0&&pixel.x<576.0)
          hud=texture2D(personalHud,vec2((pixel.x+0.5-448.0)/256.0,texcoord.y));
        else if(pixel.x>=272.0&&pixel.x<400.0)
          hud=texture2D(personalHud,vec2((pixel.x+0.5-272.0+128.0)/256.0,texcoord.y));
      }
      gl_FragColor=vec4(mix(rgb,hud.rgb,hud.a),1.0);
    }`);
  const program = gl.createProgram();
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.deleteShader(vs); gl.deleteShader(fs);
  const position = gl.getAttribLocation(program, 'position'), uv = gl.getAttribLocation(program, 'uv');
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // Match the upstream top-left RGB framebuffer orientation.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1, 0,1,  1,-1, 1,1,  1,1, 1,0,
    -1,-1, 0,1,  1,1, 1,0, -1,1, 0,0,
  ]), gl.STATIC_DRAW);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const sampler = gl.getUniformLocation(program, 'image');
  const sidebarBlack=gl.getUniformLocation(program,'sidebarBlack'),normalizeSidebar=gl.getUniformLocation(program,'normalizeSidebar');
  const point1=gl.getUniformLocation(program,'hitpoint1'),point2=gl.getUniformLocation(program,'hitpoint2'),point3=gl.getUniformLocation(program,'hitpoint3'),frameSize=gl.getUniformLocation(program,'frameSize');
  const hudSampler=gl.getUniformLocation(program,'personalHud'),hudTexture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,hudTexture);
  for(const [parameter,value]of [[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE],[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST]])gl.texParameteri(gl.TEXTURE_2D,parameter,value);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
  let hudRevision=-1;
  let width = 0, height = 0;
  let current=null,pending=false;
  function drawCurrent(){
    if(!current||!pending||mod.suppressPresentation)return;
    const {frame,frameWidth,frameHeight}=current;
    pending=false;
    metrics.submitted++;
    if (gl.isContextLost()) throw Error('GPU 画面上下文已丢失，请重新开始');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, frameWidth, frameHeight);
    gl.useProgram(program);
    for (const capability of [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE]) gl.disable(capability);
    gl.colorMask(true, true, true, true);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(uv);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(sampler, 0);
    const points=mod.getHitPoints?.()||[];
    gl.uniform2f(point1,...(points[0]||[-100,-100]));gl.uniform2f(point2,...(points[1]||[-100,-100]));
    gl.uniform2f(point3,...(points[2]||[-100,-100]));
    gl.uniform2f(frameSize,frameWidth,frameHeight);
    const background=frameWidth===640&&frameHeight===400?mod.getSidebarBackground?.():null;
    mod.sidebarBlack=background;
    gl.uniform1i(normalizeSidebar,background?1:0);
    if(background)gl.uniform3f(sidebarBlack,...background.map(component=>component/255));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Resolve the current heap at the presentation boundary. The native RGB
    // buffer retains the latest update, including after WASM heap growth.
    const pixels = mod.HEAPU8.subarray(frame, frame + frameWidth * frameHeight * 3);
    if (width !== frameWidth || height !== frameHeight) {
      width = frameWidth; height = frameHeight;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0, gl.RGB, gl.UNSIGNED_BYTE, pixels);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGB, gl.UNSIGNED_BYTE, pixels);
    }
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,hudTexture);gl.uniform1i(hudSampler,1);
    const hud=mod.getPersonalHud?.();
    if(hud&&hud.revision!==hudRevision){
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,hud.canvas);hudRevision=hud.revision;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    metrics.drawn++;
    if(mode==='bitmap')mod.onFrameRendered(frame,frameWidth,frameHeight,metrics.submitted);
  }
  mod.updateTexture = (frame, frameWidth, frameHeight) => {
    metrics.updates++;if(pending)metrics.coalesced++;
    current={frame,frameWidth,frameHeight};pending=true;
    if(!mod.deferPresentation)drawCurrent();
  };
  Object.defineProperties(metrics,{
    capture:{value:()=>current?{...current}:null},
    restore:{value:saved=>{current=saved?{...saved}:null;pending=!!current;}},
    // Local HUD seat changes request a redraw even without a native update.
    // Deferred netplay only submits a pending final image unless requested.
    flush:{value:({redraw=!mod.deferPresentation}={})=>{if(redraw&&current)pending=true;drawCurrent();}},
  });
  return metrics;
};
