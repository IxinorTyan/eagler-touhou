import {PROTOCOL,FrameQueue} from './queue.js';
import {GameRuntime} from './runtime.js';
import {createRelay} from './relay.js';
import {loadRtcConfiguration,refreshRtcPath,countIceCandidate,describeIceCandidates,recordIceServerError,describeRtcConfiguration} from './connection.js';
import {deploymentIceConfiguration} from './udp-config.js';
import {describeNetwork} from './network-mode.js';

const ROLES=['host','guest','guest2'],TICK=1000/60;
const HASH_INTERVAL=120,HASH_WINDOW=2*HASH_INTERVAL,DISCONNECT_GRACE=10000;
export class NetSession{
  constructor(identity,room,{canvas,api,status,buttons,render,failure}){
    Object.assign(this,{identity,room,api,status,buttons,render,failure});
    this.roles=ROLES.slice(0,room.settings.players||2);
    this.remotes=this.roles.filter(r=>r!==identity.role);this.links=identity.role==='host'?this.remotes:['host'];
    this.slot=room.seats[identity.role];this.peers=new Map();
    this.hellos=new Map();this.acks=new Set();this.sentHello=new Set();this.sentAck=new Set();
    this.game=new GameRuntime(canvas,room.seats.host);
    this.game.onFailure=e=>this.fail(e);
    this.queue=new FrameQueue(this.slot,room.settings.delay,this.roles.length);
    this.hashes=new Map();this.remoteHashes=new Map(this.remotes.map(r=>[r,new Map()]));this.iceCounts={};this.iceErrors=[];
    this.closed=false;this.running=false;this.connected=false;this.lastAdvance=performance.now();
    this.rtt=0;this.lastHash=0;this.waitHash=false;this.signalChain=Promise.resolve();
    this.waitStats={since:performance.now(),elapsed:0,input:0,hash:0};
  }
  sendTo(role,value,source=this.identity.role){
    const channel=this.peers.get(role)?.channel;
    if(this.closed||channel?.readyState!=='open')throw Error('输入通道尚未就绪');
    if(channel.bufferedAmount>262144)throw Error('网络发送积压，请重开房间');
    channel.send(JSON.stringify({...value,from:source,protocol:PROTOCOL,generation:this.room.generation}));
  }
  send(value){for(const role of this.links)this.sendTo(role,value);}
  signal(target,message){
    this.signalChain=this.signalChain.then(()=>this.api('signal',{generation:this.room.generation,target,message}));
    this.signalChain.catch(e=>this.fail(e));return this.signalChain;
  }
  async prepare(){
    this.loadTask=this.game.load(this.room.settings,this.status).then(hash=>{
      if(this.closed){this.game.stop();return;}
      this.loadedHash=hash;this.maybeHello();
    }).catch(e=>this.fail(e));
    if(this.room.transport==='ws'){
      this.relay=createRelay(this.identity,this.room.generation,this.roles,e=>this.fail(e));
      for(const role of this.links){this.peers.set(role,{});this.attach(role,this.relay.channelFor(role));}
      this.relay.connect();
    }else{
      if(this.room.settings.network==='public'&&location.protocol!=='https:'&&
        !['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw Error('公网 UDP 请使用 HTTPS 入口；可运行 start-public-tunnel.bat 获取地址');
      if(!globalThis.RTCPeerConnection)throw Error('浏览器不支持 WebRTC，请使用 Edge / Chrome 或备用转发');
      const network=this.room.settings.network??'lan',ice=this.room.settings.ice??'all';
      const config=await loadRtcConfiguration({...this.identity,network,ice},globalThis.th01NetplayUdp??deploymentIceConfiguration);
      if(network==='public'&&ice==='relay'&&config.iceTransportPolicy!=='relay')throw Error('本房间要求强制 TURN，连接配置未采用中继策略');
      this.iceConfigSummary=describeRtcConfiguration(config);
      if(this.closed)return;
      for(const role of this.links){
        const pc=new RTCPeerConnection(config),peer={pc,candidates:[],path:'正在建立 UDP 连接…'};this.peers.set(role,peer);
        pc.onicecandidate=e=>{if(e.candidate){countIceCandidate(this.iceCounts,e.candidate);this.signal(role,{type:'ice',candidate:e.candidate.toJSON()});}};
        pc.onicecandidateerror=e=>recordIceServerError(this.iceErrors,e);
        pc.onconnectionstatechange=()=>this.connectionChanged(role);
        pc.ondatachannel=e=>{
          if(peer.channel||e.channel.label!=='th01-inputs'){e.channel.close();this.fail(Error('收到无效数据通道'));return;}
          this.attach(role,e.channel);
        };
        if(this.identity.role==='host'){
          this.attach(role,pc.createDataChannel('th01-inputs',{ordered:true}));
          await pc.setLocalDescription(await pc.createOffer());
          await this.signal(role,{type:'offer',sdp:pc.localDescription.sdp});
        }
      }
    }
    this.connectTimer=setTimeout(()=>{if(!this.connected)this.fail(Error('打洞连接超过 30 秒：可重新建房使用 TURN（需已配置）或 TCP 服务器转发'));},30000);
    this.heartbeat=setInterval(()=>{
      if(!this.connected||this.closed)return;
      try{this.pingPeers();}catch(e){this.fail(e);}
      for(const peer of this.peers.values())if(peer.pc)refreshRtcPath(peer);
    },2000);
    this.loadTimer=setTimeout(()=>{if(!this.running)this.fail(Error('启动超过 120 秒：检查全员资源下载与版本'));},120000);
  }
  connectionChanged(role){
    const peer=this.peers.get(role);if(this.closed||!peer?.pc)return;
    const state=peer.pc.connectionState;
    if(state==='failed'||state==='closed'){
      this.fail(Error(`P${this.room.seats[role]+1} 的 UDP 连接断开，请重建房间或使用备用转发`));
    }else if(state==='disconnected'){
      // ICE can recover a brief interruption without replacing the input lane.
      // Keep reliable input delivery and the usual lockstep wait in place.
      if(peer.disconnectTimer==null){
        peer.disconnectedAt=performance.now();
        peer.disconnectTimer=setTimeout(()=>{
          if(!this.closed)this.fail(Error(`P${this.room.seats[role]+1} 的 UDP 连接中断超过 10 秒，请重建房间或使用备用转发`));
        },DISCONNECT_GRACE);
      }
    }else if(state==='connected'){
      clearTimeout(peer.disconnectTimer);peer.disconnectTimer=null;peer.disconnectedAt=null;refreshRtcPath(peer);
    }
  }
  pingPeers(){
    for(const role of this.links){
      const peer=this.peers.get(role),time=performance.now();
      peer.pings??=new Set();peer.pings.add(time);
      while(peer.pings.size>4)peer.pings.delete(peer.pings.values().next().value);
      this.sendTo(role,{type:'ping',time});
    }
  }
  recordPong(role,time){
    const peer=this.peers.get(role);
    if(!Number.isFinite(time)||!peer?.pings?.delete(time))return;
    const sample=performance.now()-time;if(sample<0||sample>10000)return;
    const previous=peer.rtt;
    peer.jitter=previous==null?0:(peer.jitter||0)*0.75+Math.abs(sample-previous)*0.25;
    peer.rtt=previous==null?sample:previous*0.75+sample*0.25;
    peer.samples=(peer.samples||0)+1;
    this.rtt=Math.max(...[...this.peers.values()].map(p=>p.rtt||0));
  }
  async receiveSignal(message){
    if(this.closed)return;
    if(message.type==='ended'){this.fail(Error('队友停止了本局'),false);return;}
    const role=message.from,peer=this.peers.get(role),pc=peer?.pc;
    if(!pc)throw Error('RTC 信令来源或传输不匹配');
    if(message.type==='ice'){
      if(pc.remoteDescription)await pc.addIceCandidate(message.candidate);else peer.candidates.push(message.candidate);
    }else{
      const expected=this.identity.role==='host'?'answer':'offer';
      if(message.type!==expected||typeof message.sdp!=='string')throw Error('RTC 协商身份无效');
      await pc.setRemoteDescription({type:message.type,sdp:message.sdp});
      for(const candidate of peer.candidates)await pc.addIceCandidate(candidate);peer.candidates=[];
      if(expected==='offer'){await pc.setLocalDescription(await pc.createAnswer());await this.signal(role,{type:'answer',sdp:pc.localDescription.sdp});}
    }
  }
  attach(role,channel){
    this.peers.get(role).channel=channel;
    channel.onopen=()=>{try{
      this.connected=this.links.every(r=>this.peers.get(r)?.channel?.readyState==='open');
      if(this.connected){clearTimeout(this.connectTimer);this.status('连接已建立，等待全员资源校验…');}this.maybeHello();
    }catch(e){this.fail(e);}};
    channel.onmessage=e=>{try{this.receive(JSON.parse(e.data),role);}catch(error){this.fail(error);}};
    channel.onerror=()=>this.fail(Error('游戏输入通道发生错误'));
    channel.onclose=()=>{if(!this.closed)this.fail(Error('队友断线，本局已停止'));};
  }
  maybeHello(){
    if(this.closed||!this.loadedHash)return;
    for(const role of this.links){
      if(this.peers.get(role)?.channel?.readyState!=='open')continue;
      if(!this.sentHello.has(role)){this.sentHello.add(role);this.sendTo(role,{type:'hello',hash:this.loadedHash,slot:this.slot});}
      const hello=this.hellos.get(role);
      if(hello){
        if(hello.hash!==this.loadedHash)throw Error('游戏、运行时或设置不同，请刷新全员页面');
        if(!this.sentAck.has(role)){this.sentAck.add(role);this.sendTo(role,{type:'loaded'});}
      }
    }
    if(this.identity.role==='host'&&!this.running&&this.links.every(r=>this.sentAck.has(r)&&this.acks.has(r))){this.send({type:'go'});this.start();}
  }
  receive(message,link){
    if(this.closed)return;
    if(message.protocol!==PROTOCOL||message.generation!==this.room.generation)throw Error('联机协议或运行代次不同');
    const source=message.from;
    if(!this.links.includes(link)||!this.remotes.includes(source)||
      (this.identity.role==='host'&&source!==link)||
      (source!==link&&!['input','hash'].includes(message.type)))throw Error('联机来源无效');
    switch(message.type){
      case 'hello':
        if(this.hellos.has(source)||message.slot!==this.room.seats[source]||typeof message.hash!=='string')throw Error('队友校验身份无效');
        this.hellos.set(source,message);this.maybeHello();break;
      case 'loaded':
        if(!this.hellos.has(source)||this.acks.has(source))throw Error('开局握手顺序无效');
        this.acks.add(source);this.maybeHello();break;
      case 'go':
        if(this.identity.role==='host'||source!=='host'||!this.sentAck.has('host')||!this.acks.has('host')||this.running)throw Error('未完成校验就尝试开局');
        this.start();break;
      case 'input':{
        if(!this.running||message.slot!==this.room.seats[source])throw Error('输入座位或开局状态无效');
        const commands=message.buttons&~(255|4096);
        if(commands&&(source!=='host'||(!this.room.settings.qa&&commands!==256)))throw Error('队友发送了未授权控制命令');
        this.queue.receive(message.frame,message.buttons,message.slot);this.forward(message,source);break;
      }
      case 'hash':{
        const hashes=this.remoteHashes.get(source);
        if(!this.running||!Number.isSafeInteger(message.frame)||message.frame<=0||message.frame%HASH_INTERVAL||message.frame>this.queue.frame+HASH_INTERVAL||
          message.frame<=this.lastHash||hashes.has(message.frame)||!/^[0-9a-f]{8}$/.test(message.hash)||typeof message.memory!=='boolean')throw Error('状态摘要帧无效');
        hashes.set(message.frame,message);this.forward(message,source);this.checkHashes();break;
      }
      case 'ping':if(!Number.isFinite(message.time))throw Error('探测无效');this.sendTo(link,{type:'pong',time:message.time});break;
      case 'pong':this.recordPong(link,message.time);break;
      case 'ended':this.fail(Error('队友停止了本局'));break;
      default:throw Error('未知联机消息');
    }
  }
  forward(message,source){
    if(this.identity.role==='host')for(const role of this.links)if(role!==source)this.sendTo(role,message,source);
  }
  checkHashes(){
    for(const [frame,local] of this.hashes){
      // Confirm in sequence; a later match must never hide an earlier mismatch.
      if(!this.remotes.every(r=>this.remoteHashes.get(r).has(frame)))break;
      for(const role of this.remotes){
        const remote=this.remoteHashes.get(role).get(frame);
        if(local.hash!==remote.hash||local.memory!==remote.memory){
          this.diagnostic={frame,role,local,remote,state:this.game.state()};throw Error(`第 ${frame} 步状态不同，本局已停止`);
        }
      }
      this.lastHash=frame;this.hashes.delete(frame);for(const hashes of this.remoteHashes.values())hashes.delete(frame);
    }
    this.waitHash=this.queue.frame-this.lastHash>=HASH_WINDOW;
  }
  start(){
    this.running=true;clearTimeout(this.loadTimer);this.game.start();
    this.status('联机运行中');this.lastAdvance=performance.now();this.nextTick=this.lastAdvance;
    this.waitStats={since:this.lastAdvance,at:this.lastAdvance,elapsed:0,input:0,hash:0};
    this.timer=setInterval(()=>this.pump(),4);
  }
  pump(){
    if(this.closed||!this.running)return;
    try{
      const now=performance.now();
      if(now-this.lastAdvance>30000)throw Error('等待队友输入超过 30 秒，请重开房间');
      this.recordWait(now);
      if(document.hidden)return;
      this.waitKind=null;
      let budget=4;
      while(now>=this.nextTick&&budget-->0){
        // Do not consume short taps while this immutable frame is already sampled.
        if(!this.queue.lanes[this.slot].has(this.queue.frame+this.queue.delay)){
          const packet=this.queue.capture(this.buttons());if(packet)this.send(packet);
        }
        // Hashes normally compare in the background. Stop only at the bounded
        // horizon; still publish this frame's immutable input for slower peers.
        this.waitHash=this.queue.frame-this.lastHash>=HASH_WINDOW;
        if(this.waitHash){this.waitKind='hash';this.nextTick=Math.max(this.nextTick,now-TICK);break;}
        const inputs=this.queue.peek();
        if(!inputs){this.waitKind='input';this.nextTick=Math.max(this.nextTick,now-TICK);break;}
        this.game.step(inputs);this.queue.commit();this.lastAdvance=performance.now();this.nextTick+=TICK;
        if(this.nextTick<now-4*TICK)this.nextTick=now;
        if(this.queue.frame%HASH_INTERVAL===0){
          const checksum=this.game.checksum();this.hashes.set(checksum.frame,checksum);
          this.send(checksum);this.checkHashes();
        }
      }
      if(now-(this.renderAt||0)>150){this.renderAt=now;this.render(this);}
    }catch(error){this.fail(error);}
  }
  recordWait(now){
    const stats=this.waitStats,elapsed=now-(stats.at??now);stats.at=now;
    if(!document.hidden&&elapsed>=0&&elapsed<1000){
      stats.elapsed+=elapsed;
      if(this.waitKind==='hash')stats.hash+=elapsed;
      else if(this.waitKind==='input')stats.input+=elapsed;
    }
    if(now-stats.since>=5000){
      this.waitPercent=stats.elapsed?100*(stats.input+stats.hash)/stats.elapsed:0;
      this.inputWaitPercent=stats.elapsed?100*stats.input/stats.elapsed:0;
      this.hashWaitPercent=stats.elapsed?100*stats.hash/stats.elapsed:0;
      stats.since=now;stats.elapsed=stats.input=stats.hash=0;
    }
  }
  waitingText(){
    if(document.hidden)return '页面隐藏，等待恢复…';
    const interrupted=[...this.peers].filter(([,p])=>p.disconnectTimer!=null).map(([r])=>`P${this.room.seats[r]+1}`);
    if(interrupted.length)return `等待队友 ${interrupted.join(' / ')} 的 UDP 连接恢复（最多 10 秒）…`;
    if(this.waitHash){
      const frame=this.hashes.keys().next().value;
      const names=this.remotes.filter(r=>!this.remoteHashes.get(r).has(frame)).map(r=>`P${this.room.seats[r]+1}`);
      return `等待队友 ${names.join(' / ')} 核对第 ${frame} 步状态…`;
    }
    if(performance.now()-this.lastAdvance>1000){
      const slots=this.queue.lanes.flatMap((lane,i)=>i!==this.slot&&!lane.has(this.queue.frame)?[`P${i+1}`]:[]);
      if(slots.length)return `等待队友 ${slots.join(' / ')} 的输入…`;
    }
    return '联机运行中';
  }
  networkQualityText(){
    const peers=[...this.peers.values()].filter(p=>p.samples),jitter=Math.max(0,...peers.map(p=>p.jitter));
    const measured=peers.length===this.links.length;
    // In 3P, guest-to-guest input traverses the host. This is a conservative
    // suggestion for the next room, never a local change to synchronized delay.
    const travel=this.rtt/(this.roles.length===2?2:1);
    const recommendation=Math.max(2,Math.ceil((travel+2*jitter)/TICK)+2);
    return `缓冲 ${this.queue.delay} 帧（约 ${(this.queue.delay*TICK).toFixed(0)} ms）`+
      (measured?` · 最大往返 ${this.rtt.toFixed(0)} ms · 抖动约 ${jitter.toFixed(0)} ms`:' · 正在测量延迟')+
      (this.waitPercent!=null?` · 近 5 秒网络等待 ${this.waitPercent.toFixed(1)}%`:'')+
      (measured&&recommendation>this.queue.delay?`\n下次开房建议缓冲 ${Math.min(12,recommendation)} 帧${recommendation>12?'；当前延迟仍可能需要等待':''}`:'');
  }
  connectionText(){
    const mode=describeNetwork({...this.room.settings,transport:this.room.transport});
    const links=[...this.peers].map(([role,p])=>`P${this.room.seats[role]+1}: ${this.room.transport==='ws'?'WebSocket':`${p.path} · ICE ${p.pc?.iceConnectionState||'new'}`} · DataChannel ${p.channel?.readyState||'等待'}${p.samples?` · 往返 ${p.rtt.toFixed(0)} ms`:''}${p.disconnectTimer!=null?' · 短暂中断，等待恢复':''}${p.iceDiagnostics?'\n'+p.iceDiagnostics:''}`).join('\n');
    return `${mode}\n`+(this.room.transport==='ws'?'':`${this.iceConfigSummary||'正在获取打洞配置…'}\n`)+links+`\n${this.networkQualityText()}`+(this.room.transport==='ws'?'':`\n${describeIceCandidates(this.iceCounts)}${this.iceErrors.length?'\n'+this.iceErrors.join('；'):''}`);
  }
  fail(error,notify=true){
    if(this.closed)return;
    if(notify)for(const role of this.links)if(this.peers.get(role)?.channel?.readyState==='open')try{this.sendTo(role,{type:'ended'});}catch{}
    this.close();
    if(notify)this.api('signal',{generation:this.room.generation,message:{type:'ended'}}).catch(()=>{});
    this.failure(error.message||String(error),this);
  }
  close(){
    if(this.closed)return;this.closed=true;this.running=false;
    for(const timer of [this.timer,this.heartbeat])clearInterval(timer);
    for(const timer of [this.connectTimer,this.loadTimer])clearTimeout(timer);
    this.game.stop();this.relay?.close();for(const peer of this.peers.values()){clearTimeout(peer.disconnectTimer);peer.disconnectTimer=null;peer.channel?.close();peer.pc?.close();}
  }
}
