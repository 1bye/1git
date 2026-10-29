"""Disposable authenticated TLS Git server; no user accounts or external network."""
import base64, http.server, os, pathlib, ssl, subprocess, sys, time, urllib.parse
root, cert, key, mode, requests = map(pathlib.Path, sys.argv[1:])
secret = os.environ["ONEGIT_FIXTURE_AUTH"]
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self): self.respond()
    def do_POST(self): self.respond()
    def respond(self):
        state = mode.read_text().strip()
        auth = self.headers.get("Authorization", "") == secret
        with requests.open("a") as log: log.write(f"{auth} {self.command} {self.path}\n")
        if state == "slow": time.sleep(30)
        if state == "redirect":
            self.send_response(302); self.send_header("Location", f"https://127.0.0.1:{self.server.server_port}/stolen.git"); self.end_headers(); return
        if not auth or state in ("401", "403"):
            payload = (secret + " reflected-fixture-secret").encode()
            self.send_response(int(state) if state in ("401", "403") else 401); self.send_header("WWW-Authenticate", 'Basic realm="fixture"'); self.send_header("Content-Length", str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        path = urllib.parse.urlsplit(self.path)
        if not path.path.startswith("/repo.git/") or ".." in path.path:
            self.send_response(404); self.end_headers(); return
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        env = os.environ.copy(); env.pop("ONEGIT_FIXTURE_AUTH", None)
        env.update(GIT_PROJECT_ROOT=str(root), GIT_HTTP_EXPORT_ALL="1", REQUEST_METHOD=self.command,
                   PATH_INFO=path.path.replace("/repo.git/", "/.git/", 1), QUERY_STRING=path.query,
                   CONTENT_TYPE=self.headers.get("Content-Type", ""), CONTENT_LENGTH=str(len(body)), REMOTE_USER="fixture")
        backend = subprocess.run(["git", "http-backend"], input=body, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, check=True)
        headers, sep, payload = backend.stdout.partition(b"\r\n\r\n")
        if not sep: headers, sep, payload = backend.stdout.partition(b"\n\n")
        values = []
        status = 200
        for line in headers.decode().splitlines():
            name, value = line.split(":", 1)
            if name.lower() == "status": status = int(value.strip().split()[0])
            else: values.append((name, value.strip()))
        self.send_response(status)
        for name, value in values: self.send_header(name, value)
        self.send_header("Content-Length", str(len(payload))); self.end_headers(); self.wfile.write(payload)
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(cert, key)
server.socket = context.wrap_socket(server.socket, server_side=True)
print(server.server_port, flush=True)
server.serve_forever()
