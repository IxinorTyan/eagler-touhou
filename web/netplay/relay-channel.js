// A reliable ordered channel with the same small interface used by RTC.
// All authenticated sockets must be routed before any game handshake sends.
export function createRelayChannel(identity){
  const url=new URL('/relay',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
  for(const key of ['room','token','generation'])url.searchParams.set(key,identity[key]);
  const socket=new WebSocket(url);
  const channel={kind:'relay',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,readyState:'connecting',
    onopen:null,onmessage:null,onclose:null,onerror:null,
    get bufferedAmount(){return socket.bufferedAmount;},
    send(data){if(channel.readyState!=='open')throw Error('局域网中继尚未连接');socket.send(data);},
    close(){channel.readyState='closed';socket.close();}};
  socket.onmessage=event=>{
    try{
      if(typeof event.data!=='string'||event.data.length>4096)throw Error('中继消息越界');
      const packet=JSON.parse(event.data);
      if(packet.type==='relay-ready'){
        if(packet.generation!==identity.generation||channel.readyState!=='connecting')throw Error('中继房间版本失效');
        channel.readyState='open';channel.onopen?.();
      }else if(packet.type==='relay-left'){
        channel.readyState='closed';channel.onclose?.();socket.close();
      }else if(packet.type==='relay-error')throw Error(packet.message);
      else if(channel.readyState==='open')channel.onmessage?.(event);
      else throw Error('中继开局顺序异常');
    }catch(error){channel.onerror?.({error});}
  };
  socket.onerror=()=>channel.onerror?.({error:Error('无法连接房主的局域网中继服务')});
  socket.onclose=()=>{channel.readyState='closed';channel.onclose?.();};
  return channel;
}
