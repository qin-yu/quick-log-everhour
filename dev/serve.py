"""Serve the side panel on http://localhost:8765/src/sidepanel/index.html with dev/mock-chrome.js injected.

The browser can't be scripted on chrome-extension:// pages, so this is how the panel UI gets driven in a normal tab.
Usage: python3 dev/serve.py [port]
"""
import http.server
import pathlib
import sys

DEV = pathlib.Path(__file__).resolve().parent
ROOT = DEV.parent
MOCK = DEV / 'mock-chrome.js'
PANEL = '/src/sidepanel/index.html'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/__mock.js':
            self.reply(MOCK.read_bytes(), 'text/javascript')
        elif path == PANEL:
            html = (ROOT / PANEL.lstrip('/')).read_text()
            self.reply(html.replace('<script type="module"', '<script src="/__mock.js"></script>\n  <script type="module"').encode(), 'text/html')
        else:
            super().do_GET()

    def reply(self, body, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'http://localhost:{port}{PANEL}')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
