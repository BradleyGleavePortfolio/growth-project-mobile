"""Loopback-only screenshot bridge; no third-party calls or credentials."""
import http.server
import pathlib
import subprocess

allowed = {
    p.stem for p in pathlib.Path(".github/shots127/flows").glob("[0-9][0-9]-*.yaml")
}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            status = 200
        elif self.path.startswith("/capture/") and self.path[9:] in allowed:
            result = subprocess.run(
                ["bash", ".github/shots127/save_native.sh", self.path[9:]],
                check=False,
            )
            status = 200 if result.returncode == 0 else 500
        else:
            status = 404
        self.send_response(status)
        self.end_headers()
        self.wfile.write(b"ok" if status == 200 else b"capture unavailable")

http.server.HTTPServer.allow_reuse_address = True
http.server.HTTPServer(("127.0.0.1", 8767), Handler).serve_forever()
