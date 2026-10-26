"""Subset GNU Unifont for the browser's Chinese pixel replay menus.

Usage: python tools/build_replay_menu_font.py path/to/unifont-15.1.05.otf
Requires fonttools and Brotli. The shipped font uses the SIL OFL option;
retain web/assets/fonts/OFL-Replay-Pixel.txt alongside generated assets.
"""
import argparse
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('font', type=Path)
args = parser.parse_args()
web = Path(__file__).resolve().parents[1] / 'web'
text = ''.join((web / name).read_text(encoding='utf-8') for name in
               ('solo.html', 'solo-frame-replay.js', 'replay-menu.js', 'lan.html', 'lan.js'))
font = TTFont(args.font)
subsetter = subset.Subsetter()
subsetter.populate(text=text + ''.join(chr(n) for n in range(32, 127)))
subsetter.subset(font)
font.flavor = 'woff2'
output = web / 'assets/fonts/replay-pixel.woff2'
output.parent.mkdir(parents=True, exist_ok=True)
font.save(output)
print(f'{output}: {output.stat().st_size} bytes')
