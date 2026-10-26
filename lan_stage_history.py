"""Bounded optional native-stage observations, separate from sync history."""
import copy
import hashlib
import json
import re

STAGE_BYTES = 2 * 1024 * 1024
TOTAL_BYTES = 4 * STAGE_BYTES


def uint(value, maximum=0xffffffff):
    return type(value) is int and 0 <= value <= maximum


def vector(value, count, maximum):
    return isinstance(value, list) and len(value) == count and all(uint(v, maximum) for v in value)


def digest(frames):
    return hashlib.sha256(json.dumps(frames, separators=(',', ':'), sort_keys=True).encode()).digest()


def validate_frames(frames, count, header):
    if frames is None:
        return [None] * count
    if not isinstance(frames, list) or len(frames) != count:
        raise ValueError('分面批次帧数无效')
    players = header['players']
    seats = header['config']['players'][:]
    if players == 2:
        seats.append(dict(seats[0], character=2))
    config = [1, header['config']['rank']]
    for seat in seats:
        config.extend([seat['character'], seat['spares'] + 1, seat['bombs']])
    config.append(players)
    for events in frames:
        if events is None:
            continue
        if not isinstance(events, list) or len(events) > 512:
            raise ValueError('分面事件批次无效')
        for e in events:
            valid = False
            if isinstance(e, list) and e and type(e[0]) is int:
                if e[0] == 0:
                    valid = len(e) == 4 and uint(e[1], 65535) and uint(e[2], 1) and uint(e[3], 255)
                elif e[0] == 1:
                    valid = len(e) == 8 and uint(e[1], 65535) and uint(e[2], 1) and vector(e[3], players-1, 127) and vector(e[4], 24, 255) and uint(e[5], (1 << players)-1) and uint(e[6]) and uint(e[7])
                elif e[0] == 2 and len(e) == 2 and isinstance(e[1], dict):
                    d = e[1]
                    valid = (set(d) == {'version', 'diskSha', 'stage', 'players', 'config', 'bytes', 'checksum'} and
                             d['version'] == 'th05-stage-initial/1' and d['diskSha'] == header['diskSha'] and
                             uint(d['stage'], 6) and type(d['players']) is int and d['players'] == players and
                             vector(d['config'], 12, 255) and d['config'] == config and vector(d['bytes'], 490, 255) and
                             isinstance(d['checksum'], str) and re.fullmatch('[a-f0-9]{8}', d['checksum']))
            if not valid:
                raise ValueError('分面事件字段无效')
    return copy.deepcopy(frames)


class StageArchive:
    def __init__(self):
        self.records = {}
        self.segments = []
        self.current = None
        self.bytes = 0

    def prune(self):
        first = self.segments[0]['first'] if self.segments else float('inf')
        for frame in list(self.records):
            if frame >= first:
                break
            _, size = self.records.pop(frame)
            self.bytes -= size

    def append(self, first, frames):
        for n, events in enumerate(frames):
            frame = first + n
            if events is None:
                self.current = None
                continue
            for event in events:
                if event[0] == 2:
                    self.current = {'first': frame, 'bytes': 0}
                    self.segments.append(self.current)
            if self.current is None:
                continue
            size = len(json.dumps(events, separators=(',', ':')))
            self.records[frame] = (events, size)
            self.bytes += size
            self.current['bytes'] += size
            if self.current['bytes'] > STAGE_BYTES:
                discarded = self.current['first']
                self.segments.pop()
                self.current = None
                for f in list(self.records):
                    if f >= discarded:
                        _, size = self.records.pop(f)
                        self.bytes -= size
            while self.bytes > TOTAL_BYTES and self.segments:
                if self.segments.pop(0) is self.current:
                    self.current = None
                self.prune()
            self.prune()

    def read(self, first, stop):
        return [copy.deepcopy(self.records[frame][0]) if frame in self.records else None for frame in range(first, stop)]
