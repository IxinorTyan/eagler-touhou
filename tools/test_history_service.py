"""In-process HTTP-handler and archive tests; no listening socket or server."""
import base64
import copy
import io
import json
import struct
import sys
import unittest
from email.message import Message
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lan_server as server
from lan_history import HistoryService, MAX_ARCHIVES, MAX_FRAMES, TTL

# Gameplay transport is mocked by the browser test; no WebSocket server starts.
server.relay_available = lambda: True


def request(method, url, data=None):
    handler = server.Handler.__new__(server.Handler)
    handler.path = url
    handler.server = SimpleNamespace(build='in-process-history-test', default_network='public-ws')
    handler.headers = Message()
    handler.headers['Host'] = '127.0.0.1:9877'
    handler.headers['Origin'] = 'http://127.0.0.1:9877'
    response = {}
    handler.reply = lambda value, status=200: response.update(status=status, body=value)
    if method == 'POST':
        raw = json.dumps(data).encode()
        handler.headers['Content-Length'] = str(len(raw))
        handler.rfile = io.BytesIO(raw)
        handler.do_POST()
    else:
        handler.do_GET()
    return response


def header(players=2):
    # The persisted input format remains /7; HTTP authorization uses the live
    # server protocol independently (now /8 with startup timing negotiation).
    return {'version': 'th05-confirmed-input/1', 'protocol': 'th05-netplay/7', 'identity': 'a'*64, 'language': 'cn', 'players': players,
            'config': {'rank': 1, 'players': [{'character': n, 'spares': 2, 'bombs': 3} for n in range(players)]},
            'coreSha': 'b'*64, 'diskSha': 'c'*64, 'guestSha': 'd'*64, 'checksum': '12345678'}


class Tests(unittest.TestCase):
    def test_full_length_archive(self):
        service = HistoryService()
        owner = ('capacity', 'generation', 'publisher')
        watch = service.open(owner, header(3))['watch']
        # Exercise the complete supported capacity, including late-reader
        # pagination and retries near the bound, without running an emulator.
        raw = struct.pack('<dddBIII', 2**43-1, 0, 32, 2, 123, 456, 0) * 60
        encoded = base64.b64encode(raw).decode()
        for first in range(0, MAX_FRAMES, 60):
            self.assertEqual(service.push(owner, watch, first, encoded)['frames'], first+60)
            if first % 6000 == 0:
                self.assertEqual(service.push(owner, watch, first, encoded)['frames'], first+60)
                read = service.read(watch, max(0, first-300))
                self.assertLessEqual(len(base64.b64decode(read['payload'])), 300*37)
        self.assertRaises(ValueError, service.push, owner, watch, MAX_FRAMES, encoded)
        service.end(owner, watch, MAX_FRAMES, 'capacity test')
        received = 0
        while received < MAX_FRAMES:
            data = service.read(watch, received)
            payload = base64.b64decode(data['payload'])
            self.assertEqual(payload, (raw*5)[:len(payload)])
            received += len(payload)//37
        self.assertEqual(received, MAX_FRAMES)
        self.assertEqual(service.read(watch, received)['end']['frames'], MAX_FRAMES)

    def test_archive(self):
        now = [0]
        service = HistoryService(lambda: now[0])
        owner = ('room', 'run', 'secret-player-token')
        h = header(3)
        watch = service.open(owner, h)['watch']
        self.assertEqual(service.open(owner, h)['watch'], watch)
        h['config']['rank'] = 4
        self.assertEqual(service.read(watch, 0)['header']['config']['rank'], 1)
        self.assertRaises(ValueError, service.open, owner, h)
        raw = struct.pack('<dddBIII', 2**43-1, 0, 32, 2, 1, 123, 0)
        encoded = base64.b64encode(raw).decode()
        self.assertEqual(service.push(owner, watch, 0, encoded)['frames'], 1)
        self.assertEqual(service.push(owner, watch, 0, encoded)['frames'], 1)
        self.assertRaises(PermissionError, service.push, ('room', 'run', 'wrong'), watch, 1, '')
        self.assertRaises(ValueError, service.push, owner, watch, 2, encoded)
        self.assertRaises(ValueError, service.push, owner, watch, 0, base64.b64encode(bytes(len(raw))).decode())
        for pair, mask, native in [([float('nan'),0,0],0,0), ([0,1,0],2,0), ([0,0,0],0,1), ([2**43,0,0],0,0)]:
            bad = base64.b64encode(struct.pack('<dddBIII', *pair, mask, 1, 2, native)).decode()
            self.assertRaises(ValueError, service.push, owner, watch, 1, bad)
        self.assertRaises(ValueError, service.push, owner, watch, 1, '!')
        self.assertRaises(ValueError, service.push, owner, watch, True, '')
        self.assertRaises(PermissionError, service.read, 'wrong', 0)
        read = service.read(watch, 0)
        self.assertEqual(base64.b64decode(read['payload']), raw)
        self.assertNotIn('owner', read)
        self.assertNotIn(owner[-1], json.dumps(read))
        service.interrupt(owner, watch)
        self.assertTrue(service.read(watch, 1)['interrupted'])
        service.push(owner, watch, 1, '')
        self.assertFalse(service.read(watch, 1)['interrupted'])
        now[0] = 16
        self.assertTrue(service.read(watch, 1)['interrupted'])
        self.assertRaises(ValueError, service.end, owner, watch, 2, 'wrong EOF')
        service.end(owner, watch, 1, 'prefix')
        self.assertEqual(service.read(watch, 1)['end']['frames'], 1)
        self.assertFalse(service.read(watch, 1)['interrupted'])
        self.assertRaises(ValueError, service.push, owner, watch, 1, encoded)
        now[0] += TTL + 1
        self.assertRaises(PermissionError, service.read, watch, 0)
        for i in range(MAX_ARCHIVES):
            service.open(('r', str(i), 'owner'), header())
        self.assertRaises(ValueError, service.open, ('r', 'overflow', 'owner'), header())

    def test_http_authorization(self):
        server.ROOMS.clear()
        server.HISTORY = HistoryService()
        def post(action, data):
            return request('POST', '/api/'+action, {'protocol': server.PROTOCOL, **data})
        host = post('create', {})['body']
        guest = post('join', {'room': host['room']})['body']
        auth = {'room': host['room'], 'generation': host['state']['generation'], 'token': host['token']}
        other = {**auth, 'token': guest['token']}
        self.assertEqual(post('history-open', {**auth, 'header': header()})['status'], 400)
        post('ready', {**auth, 'ready': True});post('ready', {**other, 'ready': True});post('start', auth)
        self.assertEqual(post('history-open', {**other, 'header': header()})['status'], 403)
        bad = header();bad['config']['players'][0]['character'] = 3
        self.assertEqual(post('history-open', {**auth, 'header': bad})['status'], 400)
        opened = post('history-open', {**auth, 'header': header()})
        self.assertEqual(opened['status'], 200)
        watch = opened['body']['watch']
        self.assertEqual(request('GET', '/api/history?watch='+watch+'&from=0')['status'], 200)
        self.assertEqual(post('leave', {**auth, 'token': watch})['status'], 403)
        self.assertEqual(post('history-push', {**other, 'watch': watch, 'first': 0, 'payload': ''})['status'], 403)
        self.assertEqual(post('history-end', {**auth, 'watch': watch, 'frames': 0, 'reason': 'done'})['status'], 200)
        self.assertEqual(request('GET', '/api/history?watch='+watch+'&from=0')['body']['end']['frames'], 0)
        self.assertEqual(request('GET', '/api/history?watch='+watch+'&from=-1')['status'], 400)


if __name__ == '__main__':
    if '--bridge' in sys.argv:
        # Playwright routes HTTP requests to this process over stdin/stdout.
        # The real handlers run, but no TCP socket is bound or accepted.
        for line in sys.stdin:
            value = json.loads(line)
            try:
                result = request(value['method'], value['url'], value.get('data'))
            except Exception as error:
                result = {'status': 500, 'body': {'error': str(error)}}
            print(json.dumps({'id': value['id'], **result}), flush=True)
    else:
        unittest.main()
