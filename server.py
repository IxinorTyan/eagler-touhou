"""Serve browser game assets only; never expose source or local compilers."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import threading
from urllib.parse import unquote,urlsplit
import webbrowser

ROOT=Path(__file__).resolve().parent/'web'

class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.js':'text/javascript','.wasm':'application/wasm','.gz':'application/octet-stream'}
    def send_head(self):
        path=unquote(urlsplit(self.path).path)
        if '\\' in path or any(part.startswith('.') for part in path.split('/') if part):
            self.send_error(404);return None
        return super().send_head()
    def list_directory(self,path):self.send_error(404)
    def end_headers(self):
        self.send_header('Cache-Control','no-cache');self.send_header('X-Content-Type-Options','nosniff');super().end_headers()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=9871);parser.add_argument('--no-browser',action='store_true');args=parser.parse_args()
    for port in range(args.port,min(args.port+20,65536)):
        try:server=ThreadingHTTPServer(('127.0.0.1',port),partial(Handler,directory=str(ROOT)));break
        except OSError as error:
            if error.errno not in (98,10048):raise
    else:raise SystemExit('No free local port')
    url=f'http://127.0.0.1:{port}/';print(f'TH01 multiorb\n{url}\nKeep this window open. Ctrl+C to stop.',flush=True)
    if not args.no_browser:threading.Timer(.5,lambda:webbrowser.open(url)).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=='__main__':main()
