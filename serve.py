
import os
import json
import struct
import http.server
import socketserver
import urllib.request
import urllib.error
import concurrent.futures
import time

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

# Generate config.js for the browser.
# SECRETS (API keys/tokens) are deliberately excluded — they must stay server-side.
_SECRET_HINTS = ('KEY', 'SECRET', 'TOKEN', 'PASSWORD')
public_env = {k: v for k, v in env_vars.items()
              if not any(h in k.upper() for h in _SECRET_HINTS)}
with open('config.js', 'w') as f:
    f.write(f'const ENV = {repr(public_env)};\n')

PORT = 3006

# ── NVIDIA Riva speech (build.nvidia.com) ──────────────────────────────
# STT: parakeet-1.1b-rnnt-multilingual-asr | TTS: magpie-tts-multilingual
NVIDIA_API_KEY = env_vars.get('NVIDIA_API_KEY', '')
RIVA_URI = 'grpc.nvcf.nvidia.com:443'
# ASR model is selected by NVCF function id, not by a request field. Override
# both together to switch models (e.g. to Nemotron ASR) via .env.local.
ASR_FUNCTION_ID = env_vars.get('NVIDIA_ASR_FUNCTION_ID', '') or '71203149-d3b7-4460-8231-1be2543a1fca'
ASR_MODEL_NAME = env_vars.get('NVIDIA_STT_MODEL', '') or 'parakeet-1.1b-rnnt-multilingual-asr'
# TTS model defaults to chatterbox-multilingual-tts (resemble.ai Chatterbox model)
NVIDIA_TTS_MODEL = env_vars.get('NVIDIA_TTS_MODEL', '') or 'chatterbox-multilingual-tts'
TTS_FUNCTION_IDS = {
    'magpie-tts-multilingual': '877104f7-e885-42b9-8de8-f6e4c6303969',
    'chatterbox-multilingual-tts': env_vars.get('NVIDIA_TTS_FUNCTION_ID', '') or 'ddacc747-1269-4fab-bfd9-8f593dead106',
}
# Deliberately NOT falling back to another model's ID: pairing Magpie's function
# ID with a Chatterbox voice would fail confusingly at request time.
TTS_FUNCTION_ID = (env_vars.get('NVIDIA_TTS_FUNCTION_ID', '')
                   or TTS_FUNCTION_IDS.get(NVIDIA_TTS_MODEL, ''))
if not TTS_FUNCTION_ID:
    print('TTS model "%s" has no NVCF function ID — set NVIDIA_TTS_FUNCTION_ID in '
          '.env.local (find it on the model page at build.nvidia.com). '
          'Audio Recap will report this until it is set.' % NVIDIA_TTS_MODEL)
# Voice naming differs per model, so it is env-overridable too.
# Voice names and native sample rate both differ per model — Chatterbox reports
# 24 kHz and only ships Male subvoices; sending Magpie's 44.1 kHz here would
# play the audio back at the wrong pitch.
TTS_DEFAULT_VOICES = {
    'magpie-tts-multilingual': 'Magpie-Multilingual.EN-US.Mia',
    'chatterbox-multilingual-tts': 'Chatterbox-Multilingual.en-US.Male',
}
TTS_DEFAULT_RATES = {
    'magpie-tts-multilingual': 44100,
    'chatterbox-multilingual-tts': 24000,
}
TTS_VOICE = (env_vars.get('NVIDIA_TTS_VOICE', '')
             or TTS_DEFAULT_VOICES.get(NVIDIA_TTS_MODEL)
             or TTS_DEFAULT_VOICES['magpie-tts-multilingual'])
TTS_RATE = int(env_vars.get('NVIDIA_TTS_RATE', '')
               or TTS_DEFAULT_RATES.get(NVIDIA_TTS_MODEL, 44100))
# Per-request input cap. Chatterbox rejects anything over 500 characters;
# Magpie tolerates more. Chunks are synthesised separately and concatenated.
TTS_DEFAULT_LIMITS = {
    'magpie-tts-multilingual': 700,
    'chatterbox-multilingual-tts': 350,
}
TTS_CHAR_LIMIT = int(env_vars.get('NVIDIA_TTS_CHAR_LIMIT', '')
                     or TTS_DEFAULT_LIMITS.get(NVIDIA_TTS_MODEL, 350))

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

def _split_for_tts(text, limit=None):
    """Split a long script into sentence-aligned chunks the TTS service accepts."""
    if limit is None:
        limit = TTS_CHAR_LIMIT
    text = ' '.join(str(text).split())
    if len(text) <= limit:
        return [text]
    parts, cur = [], ''
    import re as _re
    for sentence in _re.split(r'(?<=[.!?])\s+', text):
        if len(cur) + len(sentence) + 1 > limit and cur:
            parts.append(cur.strip())
            cur = sentence
        else:
            cur = (cur + ' ' + sentence).strip()
    if cur:
        parts.append(cur.strip())
    # A single sentence can still exceed the cap — hard-split those on words so
    # nothing is ever sent over the model's limit.
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        while len(p) > limit:
            cut = p.rfind(' ', 0, limit)
            if cut <= 0:
                cut = limit
            out.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            out.append(p)
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

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

            try:
                data = json.loads(body or b'{}')
            except Exception:
                data = {}

            want_stream = bool(data.get('stream'))

            def send_via_anthropic():
                req_data = json.dumps(data).encode('utf-8')
                anth_req = urllib.request.Request(
                    'https://api.anthropic.com/v1/messages',
                    data=req_data,
                    headers={
                        'x-api-key': anthropic_key,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json',
                    }
                )

                with urllib.request.urlopen(anth_req) as resp:
                    if want_stream:
                        self.send_response(200)
                        self.send_header('Content-Type', 'text/event-stream')
                        self.send_header('Cache-Control', 'no-cache')
                        self.send_header('X-Accel-Buffering', 'no')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        while True:
                            chunk = resp.read1(2048) if hasattr(resp, 'read1') else resp.read(2048)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            self.wfile.flush()
                        return
                    else:
                        resp_data = resp.read()
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(resp_data)

            if anthropic_key:
                try:
                    send_via_anthropic()
                    return
                except urllib.error.HTTPError as e:
                    err_body = e.read().decode('utf-8')
                    try:
                        err_json = json.loads(err_body)
                        self._json(e.code, err_json)
                    except:
                        self._json(e.code, {"error": {"message": f"Anthropic API Error: {err_body}"}})
                except Exception as e:
                    self._json(500, {"error": {"message": f"Anthropic API Error: {e}"}})
            else:
                self._json(500, {"error": {"message": "No valid API key available. Missing ANTHROPIC_API_KEY"}})
        elif self.path == '/api/tts':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            if not (RIVA_AVAILABLE and NVIDIA_API_KEY):
                self._json(503, {"error": "voice not configured (need nvidia-riva-client + NVIDIA_API_KEY)"})
                return
            if not TTS_FUNCTION_ID:
                self._json(503, {"error": 'TTS model "%s" has no function ID. Set '
                                          'NVIDIA_TTS_FUNCTION_ID in .env.local (from the model page '
                                          'on build.nvidia.com), then restart serve.py.' % NVIDIA_TTS_MODEL})
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
                chunks = _split_for_tts(text)

                def _say(part):
                    # One service per call: the stub is not documented as
                    # thread-safe, and construction is cheap next to inference.
                    # NVCF rate-limits concurrent stateful requests, so back off
                    # and retry rather than failing the whole recap.
                    delay = 0.4
                    for attempt in range(5):
                        try:
                            svc = riva.client.SpeechSynthesisService(_riva_auth(TTS_FUNCTION_ID))
                            return svc.synthesize(
                                text=part, voice_name=voice, language_code=language,
                                sample_rate_hz=TTS_RATE,
                                encoding=riva.client.AudioEncoding.LINEAR_PCM).audio
                        except Exception as err:
                            if 'exceeded rate limit' not in str(err) or attempt == 4:
                                raise
                            time.sleep(delay)
                            delay *= 1.4
                    raise RuntimeError('tts retries exhausted')

                pcm = b''.join(_say(c) for c in chunks)
                wav = pcm_to_wav(pcm, TTS_RATE, 1)
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(wav)
            except Exception as e:
                detail = str(e)
                if 'exceeded rate limit' in detail:
                    msg = 'NVIDIA rate limit hit while generating the recap. Wait a moment and press play again.'
                elif 'maximum allowed length' in detail:
                    msg = 'A line was too long for the voice model to speak. Regenerate the recap.'
                else:
                    msg = 'Audio generation failed: ' + detail.split('\n')[0][:200]
                self._json(500, {"error": msg, "detail": detail})
        elif self.path == '/api/stt':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            # On NVCF the ASR model is chosen by function id (ASR_FUNCTION_ID),
            # not by a RecognitionConfig field — the installed riva client has
            # no model_name field and raises if one is passed.
            stt_model = ASR_MODEL_NAME

            if RIVA_AVAILABLE and NVIDIA_API_KEY:
                try:
                    rate = int(self.headers.get('X-Sample-Rate', '16000') or 16000)
                    language = self.headers.get('X-Language', 'en-US') or 'en-US'
                    cfg = riva.client.RecognitionConfig(
                        encoding=riva.client.AudioEncoding.LINEAR_PCM,
                        sample_rate_hertz=rate, language_code=language,
                        max_alternatives=1, audio_channel_count=1
                    )
                    r = get_asr_service().offline_recognize(body, cfg)
                    txt = ''
                    if r.results and r.results[0].alternatives:
                        txt = r.results[0].alternatives[0].transcript
                    if txt.strip():
                        self._json(200, {"transcript": txt.strip(), "model": stt_model})
                        return
                except Exception as e:
                    print('[stt] riva path failed:', str(e).replace('\n', ' ')[:200])

            if NVIDIA_API_KEY:
                try:
                    req = urllib.request.Request(
                        'https://integrate.api.nvidia.com/v1/audio/transcriptions',
                        data=body,
                        headers={
                            'Authorization': 'Bearer ' + NVIDIA_API_KEY,
                            'Content-Type': self.headers.get('Content-Type', 'audio/wav'),
                            'NV-Model-Name': stt_model
                        },
                        method='POST'
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        res_data = json.loads(resp.read().decode('utf-8'))
                        txt = res_data.get('text') or res_data.get('transcript') or ''
                        self._json(200, {"transcript": txt.strip(), "model": stt_model})
                        return
                except Exception as e:
                    print('[stt] http fallback failed:', str(e).replace('\n', ' ')[:200])

            self._json(200, {"transcript": "", "model": stt_model})
        elif self.path == '/api/generate-image':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            if not NVIDIA_API_KEY:
                self._json(500, {"error": "Visual could not be generated. Try again.", "detail": "Missing NVIDIA_API_KEY"})
                return
            try:
                data = json.loads(body or b'{}')
            except Exception:
                data = {}
            prompt = (data.get('prompt') or '').strip()
            if not prompt:
                self._json(400, {"error": "missing prompt"})
                return
            
            # NVIDIA NIM API for FLUX image generation
            nv_url = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux-1-dev'
            req_data = json.dumps({
                "prompt": prompt,
                "mode": "base",
                "cfg_scale": 3.5,
                "aspect_ratio": "1:1",
                "steps": 25
            }).encode('utf-8')
            
            headers = {
                'Authorization': f'Bearer {NVIDIA_API_KEY}',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
            
            try:
                req = urllib.request.Request(nv_url, data=req_data, headers=headers, method='POST')
                with urllib.request.urlopen(req, timeout=30) as resp:
                    resp_bytes = resp.read()
                    resp_json = json.loads(resp_bytes.decode('utf-8'))
                    
                    b64_str = None
                    if isinstance(resp_json, dict):
                        if 'artifacts' in resp_json and len(resp_json['artifacts']) > 0:
                            b64_str = resp_json['artifacts'][0].get('base64')
                        elif 'b64_json' in resp_json:
                            b64_str = resp_json['b64_json']
                        elif 'image' in resp_json:
                            b64_str = resp_json['image']
                    
                    if b64_str:
                        img_url = b64_str if b64_str.startswith('data:') else f"data:image/png;base64,{b64_str}"
                        self._json(200, {"image_url": img_url})
                    else:
                        # Fallback SVG illustration if API returns non-standard format
                        self._json(200, {"image_url": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'><rect width='600' height='400' fill='%2318181b' rx='16'/><text x='300' y='200' fill='%23a855f7' font-family='sans-serif' font-size='18' text-anchor='middle'>FLUX.2 Klein 4B Illustration</text></svg>"})
            except Exception as e:
                self._json(500, {"error": "Visual could not be generated. Try again.", "detail": str(e)})
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
