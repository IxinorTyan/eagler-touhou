"""In-process HTTP-handler and archive tests; no listening socket or server."""
import base64
import hashlib
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
    # HTTP and persisted history both use /9, including the sticky cheat bit.
    return {'version': 'th05-confirmed-input/1', 'protocol': 'th05-netplay/9', 'identity': 'a'*64, 'language': 'cn', 'players': players,
            'config': {'rank': 1, 'players': [{'character': n, 'spares': 2, 'bombs': 3} for n in range(players)]},
            'coreSha': 'b'*64, 'diskSha': 'c'*64, 'guestSha': 'd'*64, 'checksum': '12345678'}


class Tests(unittest.TestCase):
    def test_portable_checkpoints(self):
        service = HistoryService()
        owner = ('checkpoint', 'run', 'publisher')
        watch = service.open(owner, header())['watch']
        raw = bytes(range(256)) * 200
        sha = hashlib.sha256(raw).hexdigest()
        entry = {'frame': 0, 'stage': 0, 'sha': sha, 'size': len(raw)}
        first = {**entry, 'offset': 0, 'payload': base64.b64encode(raw[:32768]).decode()}
        last = {**entry, 'offset': 32768, 'payload': base64.b64encode(raw[32768:]).decode()}
        self.assertRaises(PermissionError, service.checkpoint_push, ('x', 'x', 'x'), watch, first)
        self.assertRaises(ValueError, service.checkpoint_push, owner, watch, last)
        self.assertEqual(service.checkpoint_push(owner, watch, first)['offset'], 32768)
        self.assertEqual(service.checkpoint_push(owner, watch, first)['offset'], 32768)
        self.assertEqual(service.read(watch, 0)['checkpoints'], [])
        self.assertRaises(ValueError, service.checkpoint_read, watch, 0, 0)
        self.assertRaises(ValueError, service.checkpoint_push, owner, watch, {**first, 'payload': base64.b64encode(b'wrong').decode()})
        self.assertTrue(service.checkpoint_push(owner, watch, last)['complete'])
        self.assertTrue(service.checkpoint_push(owner, watch, last)['complete'])
        self.assertEqual(service.read(watch, 0)['checkpoints'], [entry])
        received = b''.join(base64.b64decode(service.checkpoint_read(watch, 0, at)['payload']) for at in (0, 32768))
        self.assertEqual(received, raw)
        self.assertRaises(ValueError, service.checkpoint_read, watch, True, 0)
        self.assertRaises(ValueError, service.checkpoint_read, watch, 0, len(raw))
        self.assertRaises(ValueError, service.checkpoint_push, owner, watch, {**first, 'frame': 1})
        service.checkpoint_push(owner, watch, {'done': True})
        self.assertTrue(service.read(watch, 0)['checkpointsDone'])
        other = service.open(('other', 'run', 'publisher'), header())['watch']
        self.assertRaises(ValueError, service.checkpoint_push, ('other', 'run', 'publisher'), other, {**entry, 'size': 1, 'offset': 0, 'payload': 'AA=='})
        self.assertEqual(service.read(other, 0)['checkpoints'], [])

    def test_stage_sidecar(self):
        from unittest.mock import patch
        service = HistoryService()
        owner = ('stage', 'run', 'publisher')
        h = header()
        h['stageObservation'] = 1
        watch = service.open(owner, h)['watch']
        initial = [2, {'version': 'th05-stage-initial/1', 'diskSha': h['diskSha'], 'stage': 1, 'players': 2,
                       'config': [1, 1, 0, 3, 3, 1, 3, 3, 2, 3, 3, 2], 'bytes': [0]*490, 'checksum': '00000000'}]
        poll = [0, 32, 1, 0]
        encoded = base64.b64encode(struct.pack('<ddBIII', 32, 0, 0, 1, 2, 0)).decode()
        stages = [[initial, poll]]
        self.assertEqual(service.push(owner, watch, 0, encoded, stages)['frames'], 1)
        self.assertEqual(service.read(watch, 0)['stageFrames'], stages)
        self.assertEqual(service.push(owner, watch, 0, encoded, stages)['frames'], 1)
        bad = copy.deepcopy(stages)
        bad[0][-1][1] = 33
        self.assertRaises(ValueError, service.push, owner, watch, 0, encoded, bad)
        for events in [[[0, 32, 2, 0]], [[1, 0, 0, [0], [0]*23, 0, 0, 0]], [[True]], [[2, {}]]]:
            self.assertRaises(ValueError, service.push, owner, watch, 1, encoded, [events])
        self.assertEqual(service.read(watch, 0)['frames'], 1, 'malformed optional observations never mutate a confirmed prefix')
        # Even if an accepted batch retires its oversized segment, a lost ACK
        # retries against the fixed last-upload digest, not the pruned cache.
        with patch('lan_stage_history.STAGE_BYTES', 1):
            self.assertEqual(service.push(owner, watch, 1, encoded, stages)['frames'], 2)
            self.assertEqual(service.push(owner, watch, 1, encoded, stages)['frames'], 2)
        self.assertEqual(service.read(watch, 1)['stageFrames'], [None])
        self.assertRaises(ValueError, service.push, owner, watch, 1, encoded, bad)

    def test_full_length_archive(self):
        service = HistoryService()
        owner = ('capacity', 'generation', 'publisher')
        watch = service.open(owner, header(3))['watch']
        # Exercise the complete supported capacity, including late-reader
        # pagination and retries near the bound, without running an emulator.
        raw = struct.pack('<dddBIII', 2**44-1, 0, 32, 2, 123, 456, 0) * 60
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
        raw = struct.pack('<dddBIII', 2**44-1, 0, 32, 2, 1, 123, 0)
        encoded = base64.b64encode(raw).decode()
        self.assertEqual(service.push(owner, watch, 0, encoded)['frames'], 1)
        self.assertEqual(service.push(owner, watch, 0, encoded)['frames'], 1)
        self.assertRaises(PermissionError, service.push, ('room', 'run', 'wrong'), watch, 1, '')
        self.assertRaises(ValueError, service.push, owner, watch, 2, encoded)
        self.assertRaises(ValueError, service.push, owner, watch, 0, base64.b64encode(bytes(len(raw))).decode())
        for pair, mask, native in [([float('nan'),0,0],0,0), ([0,1,0],2,0), ([0,0,0],0,1), ([2**44,0,0],0,0)]:
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
        settings = dict(server.ROOMS[host['room']]['settings'])
        self.assertEqual(post('settings', {**auth, **settings, 'stageWatch': True})['status'], 400)
        self.assertFalse(server.ROOMS[host['room']]['settings']['stageWatch'])
        before = copy.deepcopy(server.ROOMS[host['room']])
        self.assertEqual(post('watch', {'room': host['room']})['status'], 409)
        self.assertEqual(server.ROOMS[host['room']], before)
        self.assertEqual(post('history-open', {**auth, 'header': header()})['status'], 400)
        post('ready', {**auth, 'ready': True});post('ready', {**other, 'ready': True});post('start', auth)
        self.assertEqual(post('history-open', {**other, 'header': header()})['status'], 403)
        bad = header();bad['config']['players'][0]['character'] = 3
        self.assertEqual(post('history-open', {**auth, 'header': bad})['status'], 400)
        opened = post('history-open', {**auth, 'header': header()})
        self.assertEqual(opened['status'], 200)
        watch = opened['body']['watch']
        before = copy.deepcopy(server.ROOMS[host['room']])
        self.assertEqual(post('watch', {'room': host['room']})['body'], {'watch': watch})
        self.assertEqual(server.ROOMS[host['room']], before, 'watch must not occupy a seat or refresh a player lease')
        self.assertEqual(post('watch', {'room': host['room'], 'protocol': 'old'})['status'], 409)
        self.assertEqual(post('watch', {'room': 'missing'})['status'], 404)
        self.assertEqual(request('GET', '/api/history?watch='+watch+'&from=0')['status'], 200)
        self.assertEqual(post('leave', {**auth, 'token': watch})['status'], 403)
        self.assertEqual(post('history-push', {**other, 'watch': watch, 'first': 0, 'payload': ''})['status'], 403)
        self.assertEqual(post('history-end', {**auth, 'watch': watch, 'frames': 0, 'reason': 'done'})['status'], 200)
        self.assertEqual(post('watch', {'room': host['room']})['status'], 409)
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
