"""Bounded browser-authored confirmed input archive; no emulator runs here.

The HTTP host owns publisher authentication. Watch capabilities are read-only
and separate from player tokens. The service can also be exercised in-process.
"""
import base64
import copy
import re
import secrets
import struct
import threading
import time

MAX_FRAMES = 216000
MAX_ARCHIVES = 16
TTL = 900


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def validate_header(header):
    if not isinstance(header, dict) or set(header) != {'version', 'protocol', 'identity', 'language', 'players', 'config', 'coreSha', 'diskSha', 'guestSha', 'checksum'}:
        raise ValueError('旁观开局字段无效')
    count = header['players']
    if header['version'] != 'th05-confirmed-input/1' or header['protocol'] != 'th05-netplay/7' or header['language'] not in ('cn', 'jp') or not integer(count, 2, 3):
        raise ValueError('旁观开局身份无效')
    for key in ('identity', 'coreSha', 'diskSha', 'guestSha', 'checksum'):
        if not isinstance(header[key], str) or not re.fullmatch('[a-f0-9]{8}' if key == 'checksum' else '[a-f0-9]{64}', header[key]):
            raise ValueError('旁观资源摘要无效')
    config = header['config']
    if not isinstance(config, dict) or set(config) != {'rank', 'players'} or not integer(config['rank'], 0, 4) or not isinstance(config['players'], list) or len(config['players']) != count:
        raise ValueError('旁观游戏配置无效')
    for player in config['players']:
        if not isinstance(player, dict) or set(player) != {'character', 'spares', 'bombs'} or not integer(player['character'], 0, 3) or not integer(player['spares'], 0, 5) or not integer(player['bombs'], 0, 3):
            raise ValueError('旁观角色配置无效')
        if any(player[k] != config['players'][0][k] for k in ('spares', 'bombs')):
            raise ValueError('旁观初始资源必须一致')


class HistoryService:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.archives = {}

    def _prune(self):
        now = self.clock()
        for key, archive in list(self.archives.items()):
            if now - archive['updated'] > TTL:
                del self.archives[key]

    def _owner(self, watch, owner):
        self._prune()
        archive = self.archives.get(watch)
        if not archive or archive['owner'] != owner:
            raise PermissionError('旁观发布身份无效或历史已过期')
        return archive

    def open(self, owner, header):
        validate_header(header)
        with self.lock:
            self._prune()
            for watch, archive in self.archives.items():
                if archive['owner'] == owner:
                    if archive['header'] != header:
                        raise ValueError('本局旁观开局已固定')
                    return {'watch': watch, 'frames': archive['frames']}
            if len(self.archives) >= MAX_ARCHIVES:
                raise ValueError('旁观历史容量已满，玩家游戏继续')
            watch = secrets.token_urlsafe(32)
            self.archives[watch] = {'owner': owner, 'header': copy.deepcopy(header), 'raw': bytearray(), 'frames': 0,
                                    'end': None, 'interrupted': False, 'updated': self.clock()}
            return {'watch': watch, 'frames': 0}

    def push(self, owner, watch, first, encoded):
        if not isinstance(encoded, str) or len(encoded) > 4096:
            raise ValueError('旁观批次过大')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as error:
            raise ValueError('旁观输入编码无效') from error
        with self.lock:
            a = self._owner(watch, owner)
            players = a['header']['players']
            stride = players * 8 + 13
            if not integer(first, 0, MAX_FRAMES) or len(raw) % stride or len(raw) > stride * 60:
                raise ValueError('旁观批次帧数无效')
            count = len(raw) // stride
            if first + count > MAX_FRAMES or first > a['frames']:
                raise ValueError('旁观输入缺帧或超过容量')
            # A retry after a lost HTTP acknowledgement is idempotent. Never
            # replace an already confirmed prefix with different input.
            if first < a['frames']:
                if first + count > a['frames'] or a['raw'][first * stride:(first + count) * stride] != raw:
                    raise ValueError('旁观重传内容不一致')
            elif raw:
                if a['end']:
                    raise ValueError('旁观历史已经结束')
                fmt = '<' + 'd' * players + 'BIII'
                for n, row in enumerate(struct.iter_unpack(fmt, raw)):
                    pair, offline, native_hash = row[:players], row[players], row[-1]
                    if offline >= 1 << players or any(not value.is_integer() or not 0 <= value <= 2**43 - 1 for value in pair) or any(value and offline & (1 << seat) for seat, value in enumerate(pair)) or ((first + n + 1) % 120 and native_hash):
                        raise ValueError('旁观输入字段无效')
                a['raw'].extend(raw)
                a['frames'] += count
            a['updated'] = self.clock()
            a['interrupted'] = False
            return {'frames': a['frames']}

    def end(self, owner, watch, frames, reason):
        with self.lock:
            a = self._owner(watch, owner)
            if not integer(frames, 0, MAX_FRAMES) or frames != a['frames'] or not isinstance(reason, str) or len(reason) > 250:
                raise ValueError('旁观结束帧无效')
            end = {'frames': frames, 'reason': reason}
            if a['end'] and a['end'] != end:
                raise ValueError('旁观结束标记不一致')
            a['end'] = end
            a['updated'] = self.clock()
            a['interrupted'] = False
            return end.copy()

    def interrupt(self, owner, watch):
        with self.lock:
            a = self._owner(watch, owner)
            if not a['end']:
                a['interrupted'] = True
            return {'frames': a['frames']}

    def read(self, watch, first):
        with self.lock:
            self._prune()
            a = self.archives.get(watch)
            if not a:
                raise PermissionError('旁观链接无效或历史已过期')
            if not integer(first, 0, a['frames']):
                raise ValueError('旁观接收游标无效')
            stride = a['header']['players'] * 8 + 13
            stop = min(first + 300, a['frames'])
            return {'header': copy.deepcopy(a['header']), 'first': first, 'frames': a['frames'],
                    'payload': base64.b64encode(a['raw'][first * stride:stop * stride]).decode('ascii'),
                    'end': a['end'].copy() if a['end'] else None,
                    'interrupted': not a['end'] and (a['interrupted'] or self.clock() - a['updated'] > 15)}
