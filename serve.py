
import os
import json
import http.server
import socketserver
import urllib.request
import urllib.error

# Read .env.local
env_vars = {}
try:
    with open('.env.local', 'r') as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                key, val = line.strip().split('=', 1)
                env_vars[key] = val.strip("'\"")
except FileNotFoundError:
    pass

# Generate config.js for the browser
with open('config.js', 'w') as f:
    f.write(f'const ENV = {repr(env_vars)};\n')

PORT = 3006

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/generate-diagram':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            nvidia_key = env_vars.get('NVIDIA_API_KEY', '')
            req = urllib.request.Request(
                'https://integrate.api.nvidia.com/v1/images/generations',
                data=body,
                headers={
                    'Authorization': f'Bearer {nvidia_key}',
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                }
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8')
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                # If NVIDIA returns an HTML error (like a 404 page), wrap it in JSON
                try:
                    json.loads(err_body)
                    self.wfile.write(err_body.encode('utf-8'))
                except json.JSONDecodeError:
                    fallback = json.dumps({"error": f"NVIDIA API Error {e.code}", "detail": err_body})
                    self.wfile.write(fallback.encode('utf-8'))
        elif self.path == '/api/chat':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            anthropic_key = env_vars.get('ANTHROPIC_API_KEY', '')
            if not anthropic_key:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "error": {"message": "Missing ANTHROPIC_API_KEY. Add it to your .env.local file, then restart serve.py."}
                }).encode('utf-8'))
                return

            req = urllib.request.Request(
                'https://api.anthropic.com/v1/messages',
                data=body,
                headers={
                    'x-api-key': anthropic_key,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                }
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8')
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(err_body.encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        print(format % args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

with ThreadingHTTPServer(("", PORT), Handler) as httpd:
    print(f"Serving at port {PORT}")
    httpd.serve_forever()
