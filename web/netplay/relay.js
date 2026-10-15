// Transport adapter only. RTC-like channel lifecycle for existing TH02 messages.
// E7 target envelope follows eagler; E8 source envelope is our explicit extension.
export function createRelay(session,generation,roles,onFailure){
  const channels=new Map(),encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  let socket,closed=false,released=false,retryTimer,handshakeTimer,deadline=0;
  function end(){
    if(closed)return;closed=true;
    clearTimeout(retryTimer);clearTimeout(handshakeTimer);
    for(const channel of channels.values())channel.close();
    socket?.close();
  }
  function fail(reason){if(closed)return;end();onFailure(Error(reason));}
  function channelFor(role){
    const channel={label:'th02-inputs',readyState:'connecting',
      get bufferedAmount(){return socket?.bufferedAmount||0;},
      send(text){
        if(channel.readyState!=='open'||socket?.readyState!==WebSocket.OPEN)throw Error('中继通道未打开');
        const bytes=encoder.encode(text);
        if(bytes.length>262144||socket.bufferedAmount>262144)throw Error('中继发送积压或消息过大');
        const packet=new Uint8Array(bytes.length+2);packet[0]=0xe7;packet[1]=roles.indexOf(role);packet.set(bytes,2);socket.send(packet);
      },
      close(){if(channel.readyState==='closed')return;channel.readyState='closed';channel.onclose?.();}
    };
    channels.set(role,channel);return channel;
  }
  function connect(){
    if(closed)return;
    deadline||=performance.now()+30000;
    const url=new URL('/relay',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    url.search=new URLSearchParams({room:session.room,token:session.token});
    socket=new WebSocket(url);socket.binaryType='arraybuffer';
    const current=socket;
    // Browsers report intermittent DNS/TLS/upgrade failures as error + close.
    // Retry only before the shared route opens; never reconnect a running game.
    handshakeTimer=setTimeout(()=>{if(!closed&&socket===current&&current.readyState===WebSocket.CONNECTING)current.close();},8000);
    socket.onopen=()=>{if(socket===current)clearTimeout(handshakeTimer);};
    socket.onmessage=event=>{
      if(closed||socket!==current)return;
      try{
        if(typeof event.data==='string'){
          const message=JSON.parse(event.data);
          if(message.type==='route'){
            if(released||message.mode!=='relay'||message.generation!==generation)throw Error('中继开局路由不匹配');
            released=true;
            // Mark all open before callbacks can invoke maybeRun or broadcast.
            for(const channel of channels.values())channel.readyState='open';
            for(const channel of channels.values())channel.onopen?.();
          }else if(message.type==='peer-left'){
            const channel=channels.get(roles[message.peer]);
            if(!channel)throw Error('中继离线身份无效');
            if(!released)return; // A pre-route handshake may reconnect.
            channel.close();
          }else throw Error(message.message||'中继服务返回未知消息');
        }else{
          const bytes=new Uint8Array(event.data),channel=channels.get(roles[bytes[1]]);
          if(!released||bytes.length<3||bytes[0]!==0xe8||!channel)throw Error('中继来源或消息封装无效');
          if(channel.readyState==='open')channel.onmessage?.({data:decoder.decode(bytes.subarray(2))});
        }
      }catch(error){fail(error.message||String(error));}
    };
    socket.onerror=()=>{if(!closed&&socket===current&&released)fail('服务器转发连接失败，请检查公网隧道和服务窗口');};
    socket.onclose=()=>{
      if(closed||socket!==current)return;
      clearTimeout(handshakeTimer);
      if(released){fail('服务器转发连接已断开');return;}
      if(performance.now()>=deadline){fail('服务器转发在 30 秒内仍未连通，请检查所有玩家的网络及服务／隧道窗口');return;}
      retryTimer=setTimeout(connect,1000);
    };
  }
  return {channelFor,connect,close:end};
}
