"""TH05 LAN/public lobby, signaling and authenticated WebSocket input relay."""
import argparse
import hashlib
import json
import secrets
import socket
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from lan_relay import available as relay_available, handle as relay_handle

PROTOCOL = 'th05-netplay/7'
ROOT = Path(__file__).resolve().parent / 'web'
ROOMS = {}
LOCK = threading.Lock()
ROLES = ('host', 'guest', 'guest2')

def active_roles(room):
    return ROLES[:room['settings']['players']]


def build_id():
    files = ['lan.js', 'lan-worker.js', 'lan.html', 'frame-presenter.js', 'host-yield.js', 'startup-assets.js', 'game-locator.js',
               'personal-hud.js', 'hud-digits.js', 'afterimage-art.js',
               'assets/yuuka-afterimages.bin', 'assets/yuuka-afterimages.json',
             'player-ui.js', 'player-ui.css', 'touch-overlay.css', 'touch-layout.js', 'touch-input.js',
             'native-touch.js', 'native-players.js', 'dosbox-memory-diff.js', 'dosbox-snapshots.js', 'solo-native-music.js',
             'music-files.js', 'music-patch.json', 'bgm/manifest.json', 'bgm-version.js', 'bgm/akyu/manifest.json',
             'lan-music.com', 'lan-music-patch.json', 'sfx/manifest.json',
             'frame-display.js', 'sidebar-background.js', 'launch-config.js', 'disk-files.js']
    files += [str(p.relative_to(ROOT)).replace('\\', '/') for p in (ROOT / 'netplay').glob('*.js')]
    files += ['patch-cn.json', 'patch-jp.json', 'vendor/dosbox-net/runtime.json',
              'vendor/dosbox-net/dosbox-rollback.mjs', 'vendor/dosbox-net/emulators.js',
              'vendor/dosbox-net/dosbox-rollback-tracked.mjs']
    digest = hashlib.sha256()
    for name in sorted(files):
        digest.update(name.encode())
        digest.update((ROOT / name).read_bytes())
    for name in ('lan_server.py', 'lan_relay.py'):
        digest.update(name.encode())
        digest.update((ROOT.parent / name).read_bytes())
    return digest.hexdigest()


def snapshot(room):
    return {key: room[key] for key in ('generation', 'revision', 'phase', 'slots', 'characters', 'ready', 'settings', 'transport')} | {
        'protocol': PROTOCOL, 'network': room.get('network', 'lan'),
        'present': {r: bool(room['tokens'][r]) and not room.get('offline', {}).get(r, False) for r in ROLES}}


def integer(data, name, low, high):
    value = data.get(name)
    if type(value) is not int or not low <= value <= high:
        raise ValueError('房间配置无效')
    return value


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.wasm': 'application/wasm'}

    def log_message(self, *_):
        pass

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def list_directory(self, _):
        self.send_error(404)

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # A canceled boot legitimately abandons a WASM/disk download.

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def reply(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/relay':
            if not relay_available():
                return self.reply({'error': '房主服务缺少 websockets，请安装 requirements-lan.txt'}, 503)
            relay_handle(self, ROOMS, LOCK)
        elif url.path == '/api/events':
            self.api('events', {k: v[0] for k, v in parse_qs(url.query).items()})
        elif url.path == '/api/version':
            self.reply({'protocol': PROTOCOL, 'build': self.server.build, 'relayAvailable': relay_available(),
                        'defaultNetwork': getattr(self.server, 'default_network', 'lan')})
        elif url.path.startswith('/api/'):
            self.reply({'error': '未知接口'}, 404)
        else:
            if url.path == '/':
                self.path = '/index.html'
            super().do_GET()

    def do_POST(self):
        try:
            origin = self.headers.get('Origin')
            if origin and urlparse(origin).netloc != self.headers.get('Host'):
                raise ValueError('请求来源不匹配')
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 65536:
                raise ValueError('消息大小无效')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('请求格式无效')
            self.api(urlparse(self.path).path.removeprefix('/api/'), data)
        except (ValueError, TypeError, KeyError) as error:
            self.reply({'error': str(error)}, 400)

    def api(self, action, data):
        with LOCK:
            now = time.monotonic()
            for code, room in list(ROOMS.items()):
                lease = 600 if room['phase'] == 'loading' else 120
                if now - room['seen']['host'] > lease:
                    del ROOMS[code]
                elif room['phase'] == 'lobby' and any(room['tokens'][r] and now-room['seen'][r]>lease for r in active_roles(room)[1:]):
                    for r in active_roles(room)[1:]:
                        if room['tokens'][r] and now-room['seen'][r]>lease:
                            room['tokens'][r] = None
                            room['ready'][r] = False
                            room['revision'] += 1
            if action == 'create':
                if data.get('protocol') != PROTOCOL:
                    return self.reply({'error': '请刷新联机页面'}, 409)
                network = data.get('network', getattr(self.server, 'default_network', 'lan'))
                if network not in ('lan', 'public-rtc', 'public-ws'):
                    return self.reply({'error': '联机模式无效'}, 400)
                if network == 'public-ws' and not relay_available():
                    return self.reply({'error': '公网服务缺少 websockets，请安装 requirements-lan.txt'}, 503)
                if len(ROOMS) >= 64:
                    return self.reply({'error': '房间数量已满'}, 429)
                code = f'{secrets.randbelow(10000):04d}'
                while code in ROOMS:
                    code = f'{secrets.randbelow(10000):04d}'
                token = secrets.token_urlsafe(24)
                room = {'tokens': {'host': token, 'guest': None, 'guest2': None}, 'seen': dict.fromkeys(ROLES, now),
                        'generation': secrets.token_hex(16), 'revision': 1, 'phase': 'lobby',
                        'network': network, 'transport': 'relay' if network == 'public-ws' else 'rtc',
                        'slots': {'host': 0, 'guest': 1, 'guest2': 2}, 'characters': {'host': 0, 'guest': 1, 'guest2': 2},
                        'ready': dict.fromkeys(ROLES, False), 'offline': dict.fromkeys(ROLES, False), 'queues': {r: [] for r in ROLES},
                        'settings': {'rank': 1, 'spares': 2, 'bombs': 3, 'language': 'cn', 'rollback': False, 'players': 2}}
                ROOMS[code] = room
                return self.reply({'room': code, 'token': token, 'role': 'host', 'state': snapshot(room)})
            code = str(data.get('room', ''))
            room = ROOMS.get(code)
            if not room:
                return self.reply({'error': '房间不存在或已过期'}, 404)
            if action == 'join':
                if data.get('protocol') != PROTOCOL:
                    return self.reply({'error': '请刷新联机页面'}, 409)
                joining = next((r for r in active_roles(room)[1:] if not room['tokens'][r]), None)
                if joining is None or room['phase'] != 'lobby':
                    return self.reply({'error': '房间已满或已开始'}, 409)
                token = secrets.token_urlsafe(24)
                room['tokens'][joining] = token
                room['seen'][joining] = now
                room['ready'] = dict.fromkeys(ROLES, False)
                room['revision'] += 1
                return self.reply({'room': code, 'token': token, 'role': joining, 'state': snapshot(room)})
            role = next((r for r in ROLES if room['tokens'][r] and secrets.compare_digest(room['tokens'][r], str(data.get('token', '')))), None)
            if role is None:
                return self.reply({'error': '房间身份无效'}, 403)
            if data.get('generation') != room['generation']:
                return self.reply({'error': '房间版本已失效'}, 409)
            room['seen'][role] = now
            if action == 'events':
                messages, room['queues'][role] = room['queues'][role], []
                return self.reply({'state': snapshot(room), 'messages': messages})
            if action == 'leave':
                if role == 'host':
                    room['phase'] = 'ended'
                elif room['phase'] == 'loading':
                    room['offline'][role] = True
                    room['tokens'][role] = None
                    room['queues'][role].clear()
                else:
                    room['tokens'][role] = None
                    room['queues'][role].clear()
                    room['ready'] = dict.fromkeys(ROLES, False)
                room['revision'] += 1
                return self.reply({'state': snapshot(room)})
            if action == 'drop':
                dropped = data.get('roles')
                if role != 'host' or room['phase'] != 'loading':
                    return self.reply({'error': '只有房主可确认运行中的离线席位'}, 403)
                if not isinstance(dropped, list) or not dropped or any(r not in active_roles(room)[1:] for r in dropped) or len(set(dropped)) != len(dropped):
                    return self.reply({'error': '离线席位无效'}, 400)
                for r in dropped:
                    room['offline'][r] = True
                    room['tokens'][r] = None
                    room['queues'][r].clear()
                room['revision'] += 1
                return self.reply({'state': snapshot(room)})
            if action == 'fallback':
                if room['phase'] != 'loading' or not all(room['tokens'][r] for r in active_roles(room)):
                    return self.reply({'error': '房间不能切换连接方式'}, 409)
                if not relay_available():
                    return self.reply({'error': '直连失败，房主服务尚未安装局域网中继依赖（requirements-lan.txt）'}, 503)
                if room['transport'] != 'relay':
                    room['transport'] = 'relay'
                    room['queues'] = {r: [] for r in ROLES}
                    room['revision'] += 1
                return self.reply({'state': snapshot(room)})
            if action == 'signal':
                other = data.get('to')
                if other not in active_roles(room) or other == role:
                    return self.reply({'error': '信令目标无效'}, 400)
                signal = data.get('signal')
                if room['phase'] != 'loading' or not room['tokens'][other] or room['transport'] != 'rtc':
                    return self.reply({'error': '房间连接状态无效'}, 409)
                if not isinstance(signal, dict) or signal.get('type') not in ('offer', 'answer', 'repair'):
                    return self.reply({'error': '连接消息无效'}, 400)
                attempt = signal.get('attempt', 0)
                if type(attempt) is not int or not 0 <= attempt <= 1000000000 or len(room['queues'][other]) >= 8:
                    return self.reply({'error': '连接消息越界'}, 400)
                if signal['type'] == 'repair':
                    if ROLES.index(role) < ROLES.index(other) or set(signal) != {'type'}:
                        return self.reply({'error': '重连请求身份无效'}, 400)
                elif signal['type'] != ('offer' if ROLES.index(role)<ROLES.index(other) else 'answer') or not isinstance(signal.get('sdp'), str) or len(signal['sdp']) > 60000:
                    return self.reply({'error': '连接消息越界'}, 400)
                room['queues'][other].append({'from': role, 'signal': signal})
                return self.reply({'ok': True})
            if room['phase'] != 'lobby':
                return self.reply({'error': '游戏开始后不能修改配置'}, 409)
            try:
                if action == 'settings':
                    if role != 'host':
                        return self.reply({'error': '只有房主可以修改共同配置'}, 403)
                    settings = {k: integer(data, k, 0, hi) for k, hi in [('rank', 4), ('spares', 5), ('bombs', 3)]}
                    if data.get('language') not in ('cn', 'jp'):
                        raise ValueError('游戏语言无效')
                    settings['language'] = data['language']
                    rollback = data.get('rollback', False)
                    if type(rollback) is not bool:
                        raise ValueError('回滚选项无效')
                    settings['rollback'] = rollback
                    players=data.get('players',room['settings']['players'])
                    if type(players) is not int or players not in (2,3):
                        raise ValueError('玩家人数无效')
                    if players==2 and room['tokens']['guest2']:
                        raise ValueError('第三位队友需先离开才能改为两人')
                    if players != room['settings']['players']:
                        room['slots'] = dict(zip(ROLES,range(3)))
                    settings['players']=players
                    room['settings'] = settings
                    room['ready'] = dict.fromkeys(ROLES, False)
                elif action == 'seat':
                    if role != 'host':
                        return self.reply({'error': '只有房主可以交换座位'}, 403)
                    seat = integer(data, 'seat', 0, room['settings']['players']-1)
                    remaining=[n for n in range(room['settings']['players']) if n!=seat]
                    room['slots'] = {'host': seat, **dict(zip(active_roles(room)[1:],remaining))}
                    if room['settings']['players']==2:room['slots']['guest2']=2
                    room['ready'] = dict.fromkeys(ROLES, False)
                elif action == 'character':
                    room['characters'][role] = integer(data, 'character', 0, 3)
                    room['ready'] = dict.fromkeys(ROLES, False)
                elif action == 'ready':
                    if type(data.get('ready')) is not bool:
                        raise ValueError('准备状态无效')
                    room['ready'][role] = data['ready']
                elif action == 'start':
                    if role != 'host' or not all(room['tokens'][r] for r in active_roles(room)) or not all(room['ready'][r] for r in active_roles(room)):
                        return self.reply({'error': '需要全员准备后由房主开始'}, 409)
                    room['phase'] = 'loading'
                else:
                    return self.reply({'error': '未知接口'}, 404)
            except ValueError as error:
                return self.reply({'error': str(error)}, 400)
            room['revision'] += 1
            self.reply({'state': snapshot(room)})


class LanHTTPServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can silently start two different builds on one
    # port. Require one owner so API and static files belong to the same build.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=9893)
    parser.add_argument('--bind', default='0.0.0.0')
    parser.add_argument('--network', choices=('lan', 'public-rtc', 'public-ws'), default='lan',
                        help='Default mode for rooms created without an explicit mode')
    args = parser.parse_args()
    if args.network == 'public-ws' and not relay_available():
        parser.error('公网中继需要 websockets，请安装 requirements-lan.txt')
    server = LanHTTPServer((args.bind, args.port), partial(Handler, directory=str(ROOT)))
    server.build = build_id()
    server.default_network = args.network
    print(f'TH05 LAN: http://127.0.0.1:{server.server_port}/', flush=True)
    for address in sorted({r[4][0] for r in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)}):
        print(f'LAN address: http://{address}:{server.server_port}/', flush=True)
    if args.network == 'public-rtc':
        print('Public rooms prefer WebRTC with STUN; WebSocket relay is available as fallback when installed.', flush=True)
    if args.network == 'public-ws':
        print('Public rooms use the same-origin WebSocket relay. Share your deployed public URL.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
