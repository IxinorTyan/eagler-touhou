"""TH05 authenticated two/three-player WebSocket input relay.

Uses the same websockets Sans-I/O + bounded FIFO approach as the current
TH04 relay. HTTP server keeps hosting the existing game page on one port.
"""
import json
import secrets
import select
import socket
import threading
import time
from collections import deque
from urllib.parse import parse_qs, urlparse

HUB_LOCK = threading.RLock()
HUBS = {}


def available():
    try:
        from websockets.server import ServerProtocol
        return True
    except ImportError:
        return False


class Writer:
    def __init__(self, sock):
        self.sock = sock
        self.condition = threading.Condition()
        self.chunks = deque()
        self.bytes = 0
        self.stopping = False
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def abort(self):
        with self.condition:
            self.stopping = True
            self.chunks.clear()
            self.bytes = 0
            self.condition.notify()
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def put(self, chunk):
        with self.condition:
            if self.stopping:
                raise OSError('relay closed')
            if self.bytes + len(chunk) <= 65536 and len(self.chunks) < 256:
                self.chunks.append(chunk)
                self.bytes += len(chunk)
                self.condition.notify()
                return
        self.abort()
        raise OSError('relay congestion')

    def run(self):
        try:
            while True:
                with self.condition:
                    self.condition.wait_for(lambda: self.chunks or self.stopping)
                    if not self.chunks:
                        return
                    chunk = self.chunks.popleft()
                    self.bytes -= len(chunk)
                self.sock.sendall(chunk)
        except OSError:
            self.abort()

    def close(self):
        with self.condition:
            self.stopping = True
            self.condition.notify()
        self.thread.join(timeout=0.25)
        self.abort()


def handle(handler, rooms, room_lock):
    from websockets.server import ServerProtocol
    from websockets.protocol import OPEN
    from websockets.frames import OP_TEXT, OP_CONT, OP_CLOSE
    origin = urlparse(handler.headers.get('Origin', ''))
    if origin.scheme not in ('http', 'https') or origin.netloc != handler.headers.get('Host'):
        return handler.reply({'error': '中继来源不匹配'}, 403)
    query = {k: v[0] for k, v in parse_qs(urlparse(handler.path).query).items()}
    code, token, generation = (query.get(k, '') for k in ('room', 'token', 'generation'))
    with room_lock:
        room = rooms.get(code)
        role = next((r for r in ('host', 'guest', 'guest2') if room and room['tokens'][r] and secrets.compare_digest(room['tokens'][r], token)), None)
        if not role or room['phase'] != 'loading' or room['generation'] != generation or room['transport'] != 'relay':
            return handler.reply({'error': '中继房间或身份无效'}, 403)
        slot = room['slots'][role]
        roles=('host','guest','guest2')[:room['settings']['players']]
        if role not in roles:return handler.reply({'error':'中继座位无效'},403)
    key = (code, generation)
    sock = handler.connection
    sock.settimeout(5)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    handler.close_connection = True
    protocol = ServerProtocol(max_size=4096)
    protocol_lock = threading.Lock()
    writer = Writer(sock)

    def flush():
        for chunk in protocol.data_to_send():
            if chunk:
                writer.put(chunk)

    def send(text):
        with protocol_lock:
            if protocol.state is not OPEN:
                raise OSError('relay closed')
            protocol.send_text(text.encode())
            flush()

    entry = {'send': send, 'ready': False, 'close': writer.abort}
    try:
        request = (handler.requestline + '\r\n' + ''.join(f'{k}: {v}\r\n' for k, v in handler.headers.items()) + '\r\n').encode('iso-8859-1')
        protocol.receive_data(request)
        events = protocol.events_received()
        if len(events) != 1:
            return
        response = protocol.accept(events[0])
        protocol.send_response(response)
        flush()
        if response.status_code != 101:
            return
        with HUB_LOCK:
            hub = HUBS.setdefault(key, {})
            previous = hub.get(role)
            if previous:
                previous['close']()
            hub[role] = entry
            if room.get('relay_started'):
                entry['ready'] = True
                send(json.dumps({'type': 'relay-ready', 'generation': generation}))
                for peer_role, item in hub.items():
                    if peer_role != role:
                        try:
                            item['send'](json.dumps({'type': 'relay-peer', 'role': role, 'connected': True}))
                        except OSError:
                            item['close']()
            elif len(hub) == len(roles):
                for item in hub.values():
                    item['send'](json.dumps({'type': 'relay-ready', 'generation': generation}))
                for item in hub.values():
                    item['ready'] = True
                room['relay_started'] = True
        fragments = bytearray()
        started = last_data = time.monotonic()
        while True:
            with room_lock:
                current = rooms.get(code)
                valid = current and current['generation'] == generation and current['phase'] == 'loading' and current['tokens'][role] == token
            with HUB_LOCK:
                valid = valid and HUBS.get(key, {}).get(role) is entry
            if not valid or time.monotonic() - last_data > (130 if entry['ready'] else 30):
                break
            if not select.select([sock], [], [], 1)[0]:
                continue
            chunk = sock.recv(65536)
            if not chunk:
                break
            with protocol_lock:
                protocol.receive_data(chunk)
                events = protocol.events_received()
                flush()
                opened = protocol.state is OPEN
            if not opened:
                break
            for event in events:
                if event.opcode == OP_CLOSE:
                    return
                if event.opcode not in (OP_TEXT, OP_CONT):
                    raise ValueError('text messages expected')
                fragments.extend(event.data)
                if len(fragments) > 4096:
                    raise ValueError('message too large')
                if not event.fin:
                    continue
                text = fragments.decode('utf-8')
                fragments.clear()
                message = json.loads(text)
                if not isinstance(message, dict) or message.get('type') not in ('hello', 'loaded', 'timing', 'go', 'input', 'input-tail', 'rollback', 'hash', 'stop', 'ping', 'pong', 'resume', 'suspect', 'departure-prepare', 'departure-report', 'departure-commit'):
                    raise ValueError('invalid packet')
                if (message['type'] in ('input', 'input-tail') and message.get('slot') != slot) or (message['type'] in ('go', 'rollback', 'departure-prepare', 'departure-commit') and role != 'host') or (message['type'] == 'resume' and (not isinstance(message.get('hello'), dict) or message['hello'].get('slot') != slot)):
                    raise ValueError('wrong source')
                destination = message.get('to')
                if destination is not None and (destination not in roles or destination == role):
                    raise ValueError('wrong destination')
                last_data = time.monotonic()
                with room_lock:
                    if current:
                        current['seen'][role] = last_data
                with HUB_LOCK:
                    hub=HUBS.get(key,{})
                    if hub.get(role) is not entry:
                        raise ValueError('replaced connection')
                    targets=[hub.get(r) for r in roles if r!=role and (destination is None or destination == r)]
                    if not entry['ready']:
                        raise ValueError('peer not ready')
                    # The authenticated server supplies source identity.
                    routed=json.dumps({**message,'from':role},separators=(',',':'))
                    for target in targets:
                        if target:
                            try:
                                target['send'](routed)
                            except OSError:
                                target['close']()
    except (OSError, ValueError, UnicodeError):
        pass
    finally:
        with HUB_LOCK:
            hub = HUBS.get(key, {})
            if hub.get(role) is entry:
                del hub[role]
                for item in hub.values():
                    try:
                        item['send'](json.dumps({'type': 'relay-left', 'role': role}))
                    except OSError:
                        pass
                if not hub:
                    HUBS.pop(key, None)
        with protocol_lock:
            try:
                if protocol.state is OPEN:
                    protocol.send_close(1000, 'relay ended')
                    flush()
            except OSError:
                pass
        writer.close()
