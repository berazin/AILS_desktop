"""Serve trusted editor assets on a separate loopback origin, with no file API."""
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading

class StudioHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
            return self.send_error(403)
        if not self.path.startswith('/rhwp/') or '..' in self.path or self.path.endswith('/registerSW.js'):
            return self.send_error(404)
        route = self.path.split('?', 1)[0]
        if route in {'/rhwp/', '/rhwp/index.html', '/rhwp/ails-bridge.js'}:
            if route.endswith('.js'):
                data = Path(__file__).with_name('office_studio_bridge.js').read_bytes()
                mime = 'text/javascript; charset=utf-8'
            else:
                data = (Path(self.directory) / 'index.html').read_bytes().replace(b'</head>', b'<script defer src="/rhwp/ails-bridge.js"></script></head>')
                mime = 'text/html; charset=utf-8'
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.path = self.path.removeprefix('/rhwp')
        return super().do_GET()

    def list_directory(self, path):
        return self.send_error(403)

    def end_headers(self):
        # Same-origin WASM and fonts only. No external font CDN, AI, or API.
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, *args):
        pass


class OfficeStudioRuntime:
    """Own one optional editor origin for the application's finite lifetime."""

    def __init__(self, *, root: Path | None = None, manifest: Path | None = None):
        resources = Path(__file__).resolve().parents[2]
        self._root = (root if root is not None else resources / 'vendor/rhwp-studio').resolve()
        self._manifest = manifest if manifest is not None else resources / 'scripts/dev/office-runtime.lock.json'
        self._lock = threading.Lock()
        self._server = None
        self._thread = None
        self._closed = False

    def start(self) -> str:
        with self._lock:
            if self._closed:
                raise RuntimeError('AILS office studio has closed')
            if self._server is not None:
                return f'http://127.0.0.1:{self._server.server_port}/rhwp/'
            if not self._manifest.is_file() or not self._root.is_dir():
                raise ValueError('로컬 한글 편집기 리소스가 없습니다. 개발 환경에서 prepare_office_runtime.py를 실행해야 합니다.')
            for name, expected in json.loads(self._manifest.read_text())['files'].items():
                target = (self._root / name).resolve()
                if not target.is_relative_to(self._root) or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
                    raise ValueError('한글 편집기 리소스 무결성 검사에 실패했습니다.')
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(StudioHandler, directory=str(self._root)))
            thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.1),
                                      daemon=True, name='office-studio')
            try:
                thread.start()
            except BaseException:
                server.server_close()
                raise
            self._server, self._thread = server, thread
            return f'http://127.0.0.1:{server.server_port}/rhwp/'

    def close(self):
        # Keep the lock until the listener and serving thread have both stopped.
        # A concurrent start/close cannot restart or outlive its application.
        with self._lock:
            self._closed = True
            if self._server is None:
                return
            self._server.shutdown()
            try:
                self._server.server_close()
            finally:
                self._thread.join()
            self._server, self._thread = None, None
