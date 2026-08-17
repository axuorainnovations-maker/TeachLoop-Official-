
import os
import json
import struct
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

# ── NVIDIA Riva speech (build.nvidia.com) ──────────────────────────────
# STT: parakeet-1.1b-rnnt-multilingual-asr | TTS: magpie-tts-multilingual
NVIDIA_API_KEY = env_vars.get('NVIDIA_API_KEY', '')
RIVA_URI = 'grpc.nvcf.nvidia.com:443'
ASR_FUNCTION_ID = '71203149-d3b7-4460-8231-1be2543a1fca'
TTS_FUNCTION_ID = '877104f7-e885-42b9-8de8-f6e4c6303969'
TTS_VOICE = 'Magpie-Multilingual.EN-US.Mia'
TTS_RATE = 44100

try:
    import riva.client
    RIVA_AVAILABLE = True
except Exception as _e:
    RIVA_AVAILABLE = False
    print('nvidia-riva-client not installed — voice STT/TTS disabled:', _e)

_asr_service = None
_tts_service = None

def _riva_auth(function_id):
    return riva.client.Auth(None, True, RIVA_URI,
                            [['function-id', function_id],
                             ['authorization', 'Bearer ' + NVIDIA_API_KEY]])

def get_asr_service():
    global _asr_service
    if _asr_service is None:
        _asr_service = riva.client.ASRService(_riva_auth(ASR_FUNCTION_ID))
    return _asr_service

def get_tts_service():
    global _tts_service
    if _tts_service is None:
        _tts_service = riva.client.SpeechSynthesisService(_riva_auth(TTS_FUNCTION_ID))
    return _tts_service

def pcm_to_wav(pcm, rate, channels=1, bits=16):
    byte_rate = rate * channels * bits // 8
    block_align = channels * bits // 8
    data_len = len(pcm)
    header = (b'RIFF' + struct.pack('<I', 36 + data_len) + b'WAVE'
              + b'fmt ' + struct.pack('<IHHIIHH', 16, 1, channels, rate, byte_rate, block_align, bits)
              + b'data' + struct.pack('<I', data_len))
    return header + pcm

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
        elif self.path == '/api/tts':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            if not (RIVA_AVAILABLE and NVIDIA_API_KEY):
                self._json(503, {"error": "voice not configured (need nvidia-riva-client + NVIDIA_API_KEY)"})
                return
            try:
                data = json.loads(body or b'{}')
            except Exception:
                data = {}
            text = (data.get('text') or '').strip()
            if not text:
                self._json(400, {"error": "missing text"})
                return
            voice = data.get('voice') or TTS_VOICE
            language = data.get('language') or 'en-US'
            try:
                resp = get_tts_service().synthesize(
                    text=text, voice_name=voice, language_code=language,
                    sample_rate_hz=TTS_RATE, encoding=riva.client.AudioEncoding.LINEAR_PCM)
                wav = pcm_to_wav(resp.audio, TTS_RATE, 1)
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(wav)
            except Exception as e:
                self._json(500, {"error": "tts failed", "detail": str(e)})
        elif self.path == '/api/stt':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            if not (RIVA_AVAILABLE and NVIDIA_API_KEY):
                self._json(503, {"error": "voice not configured (need nvidia-riva-client + NVIDIA_API_KEY)"})
                return
            try:
                rate = int(self.headers.get('X-Sample-Rate', '16000') or 16000)
            except ValueError:
                rate = 16000
            language = self.headers.get('X-Language', 'en-US') or 'en-US'
            try:
                cfg = riva.client.RecognitionConfig(
                    encoding=riva.client.AudioEncoding.LINEAR_PCM,
                    sample_rate_hertz=rate, language_code=language,
                    max_alternatives=1, audio_channel_count=1)
                r = get_asr_service().offline_recognize(body, cfg)
                txt = ''
                if r.results and r.results[0].alternatives:
                    txt = r.results[0].alternatives[0].transcript
                self._json(200, {"transcript": txt.strip()})
            except Exception as e:
                self._json(500, {"error": "stt failed", "detail": str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def _json(self, code, obj):
        payload = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(payload)

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
