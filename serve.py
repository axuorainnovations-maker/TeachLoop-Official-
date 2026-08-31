
import os
import json
import struct
import http.server
import socketserver
import urllib.request
import urllib.error
import concurrent.futures
import secrets
import time
import threading

import noura_meter
from noura_meter import LEDGER

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

# ── Metering and credits ───────────────────────────────────────────────
# ANTHROPIC_ADMIN_KEY is optional and only enables org reconciliation.
# There is no API that reports a remaining balance, so the ceiling below is
# OUR OWN number and every figure derived from it is labelled as such.
ANTHROPIC_ADMIN_KEY = env_vars.get('ANTHROPIC_ADMIN_KEY', '')
MONTHLY_BUDGET_USD = float(env_vars.get('NOURA_MONTHLY_BUDGET_USD', '') or 0) or None
BUDGET_WARN_PCT = float(env_vars.get('NOURA_BUDGET_WARN_PCT', '') or 80)
ADMIN_TOKEN = env_vars.get('NOURA_ADMIN_TOKEN', '')
# on | log_only | off. Ship as log_only, watch real numbers, then enforce.
CREDIT_ENFORCEMENT = (env_vars.get('NOURA_CREDIT_ENFORCEMENT', '') or 'log_only').lower()

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
TTS_LOCK = threading.Lock()
LAST_TTS_TIME = 0.0

# Voice naming differs per model, so it is env-overridable too.
# Voice names and native sample rate both differ per model — Chatterbox reports
# 24 kHz and only ships Male subvoices; sending Magpie's 44.1 kHz here would
# play the audio back at the wrong pitch.
TTS_DEFAULT_VOICES = {
    'magpie-tts-multilingual': 'Magpie-Multilingual.EN-US.Sofia',
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

    # ── identity ────────────────────────────────────────────────────────
    # Beta-grade only: a server-minted HttpOnly cookie the page cannot rewrite.
    # It is NOT authentication - clearing cookies yields a fresh allowance.
    def _identify(self, data=None):
        uid = noura_meter.parse_cookie_uid(self.headers.get('Cookie'))
        minted = False
        if not uid:
            uid = noura_meter.new_user_id()
            minted = True
        email = None
        if isinstance(data, dict):
            email = (data.get('_noura_email') or None)
        if not email:
            email = self.headers.get('X-Noura-Email') or None
        LEDGER.ensure_user(uid, email=email)
        self._pending_uid = uid if minted else None
        return uid

    def _set_uid_cookie(self):
        if getattr(self, '_pending_uid', None):
            self.send_header('Set-Cookie',
                             'noura_uid=%s; Path=/; Max-Age=63072000; HttpOnly; SameSite=Lax'
                             % self._pending_uid)
            self._pending_uid = None

    def _surface(self, data=None):
        s = self.headers.get('X-Noura-Surface')
        if not s and isinstance(data, dict):
            s = data.get('_noura_surface')
        return s or 'unknown'

    def _gate(self, uid, surface):
        """Returns (allowed, info). Logs a rejection event when it blocks."""
        allowed, info = LEDGER.check(uid, surface,
                                     enforcement=CREDIT_ENFORCEMENT,
                                     org_ceiling=MONTHLY_BUDGET_USD)
        if info.get('would_block'):
            LEDGER.append(user_id=uid, surface=surface, provider='none',
                          model=None, input_tokens=0, cache_read=0, cache_write=0,
                          output_tokens=0, usd_cost=0.0, credits=0,
                          ok=False, error=info.get('error'),
                          enforced=(CREDIT_ENFORCEMENT == 'on'))
        return allowed, info

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

            # ── metering gate ──────────────────────────────────────────
            uid = self._identify(data)
            surface = self._surface(data)
            allowed, gate = self._gate(uid, surface)
            if not allowed:
                self._json(402, gate)
                return
            # Strip our own metadata before forwarding to Anthropic.
            data.pop('_noura_surface', None)
            data.pop('_noura_email', None)
            meter = {'model': data.get('model')}

            def _record(input_tokens, cache_read, cache_write, output_tokens,
                        model, request_id=None):
                usd = noura_meter.token_cost(model, input_tokens, cache_read,
                                             cache_write, output_tokens)
                LEDGER.append(user_id=uid, surface=surface, provider='anthropic',
                              model=model, input_tokens=input_tokens,
                              cache_read=cache_read, cache_write=cache_write,
                              output_tokens=output_tokens, usd_cost=usd,
                              credits=noura_meter.credit_cost(surface),
                              request_id=request_id)

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
                        self._set_uid_cookie()
                        self.end_headers()
                        # Usage arrives inside the stream itself, so tee the
                        # bytes through the accumulator on the way out.
                        su = noura_meter.StreamUsage()
                        try:
                            while True:
                                chunk = resp.read1(2048) if hasattr(resp, 'read1') else resp.read(2048)
                                if not chunk:
                                    break
                                su.feed(chunk)
                                self.wfile.write(chunk)
                                self.wfile.flush()
                        finally:
                            # Record whatever was seen, even on a broken pipe:
                            # those tokens were still generated and billed.
                            _record(su.input_tokens, su.cache_read, su.cache_write,
                                    su.output_tokens, su.model or meter['model'],
                                    resp.headers.get('request-id'))
                        return
                    else:
                        resp_data = resp.read()
                        try:
                            j = json.loads(resp_data)
                            u = j.get('usage') or {}
                            _record(u.get('input_tokens', 0) or 0,
                                    u.get('cache_read_input_tokens', 0) or 0,
                                    u.get('cache_creation_input_tokens', 0) or 0,
                                    u.get('output_tokens', 0) or 0,
                                    j.get('model') or meter['model'],
                                    resp.headers.get('request-id'))
                        except Exception as e:
                            print('[meter] could not read usage:', e)
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self._set_uid_cookie()
                        self.end_headers()
                        self.wfile.write(resp_data)

            def send_via_nvidia():
                nv_key = env_vars.get('NVIDIA_API_KEY', '')
                if not nv_key:
                    raise RuntimeError("Missing NVIDIA_API_KEY")
                msgs = data.get('messages', [])
                sys_prompt = data.get('system', '')
                formatted_msgs = []
                if sys_prompt:
                    if isinstance(sys_prompt, list):
                        sys_str = "\n\n".join([x.get('text', '') if isinstance(x, dict) else str(x) for x in sys_prompt])
                    else:
                        sys_str = str(sys_prompt)
                    formatted_msgs.append({"role": "system", "content": sys_str})
                for m in msgs:
                    content = m.get("content", "")
                    if isinstance(content, list):
                        content_str = "\n".join([x.get('text', '') if isinstance(x, dict) else str(x) for x in content])
                    else:
                        content_str = str(content)
                    formatted_msgs.append({"role": m.get("role", "user"), "content": content_str})
                
                candidate_models = [
                    'google/diffusiongemma-26b-a4b-it',
                    'meta/llama-3.2-11b-vision-instruct',
                    'poolside/laguna-xs-2.1',
                    'nvidia/nemotron-3.5-lightning-30b-a3b'
                ]
                
                last_err = None
                for chosen_model in candidate_models:
                    req_body = json.dumps({
                        "model": chosen_model,
                        "messages": formatted_msgs,
                        "max_tokens": min(data.get("max_tokens", 800) or 800, 1200)
                    }).encode('utf-8')
                    
                    req = urllib.request.Request(
                        'https://integrate.api.nvidia.com/v1/chat/completions',
                        data=req_body,
                        headers={
                            'Authorization': f'Bearer {nv_key}',
                            'Content-Type': 'application/json'
                        }
                    )
                    try:
                        with urllib.request.urlopen(req, timeout=16) as resp:
                            resp_data = json.loads(resp.read().decode('utf-8'))
                            reply = resp_data.get('choices', [{}])[0].get('message', {}).get('content', '')
                            out_payload = {
                                "reply": reply,
                                "content": [{"type": "text", "text": reply}]
                            }
                            self.send_response(200)
                            self.send_header('Content-Type', 'application/json')
                            self.send_header('Access-Control-Allow-Origin', '*')
                            self._set_uid_cookie()
                            self.end_headers()
                            self.wfile.write(json.dumps(out_payload).encode('utf-8'))
                            return
                    except Exception as e:
                        last_err = e
                        print(f'[chat] NVIDIA model {chosen_model} failed: {e}')
                
                raise RuntimeError(f"All NVIDIA models failed. Last error: {last_err}")

            if anthropic_key:
                try:
                    send_via_anthropic()
                    return
                except Exception as e:
                    print('[chat] Anthropic failed, falling back to NVIDIA NIM:', e)

            if env_vars.get('NVIDIA_API_KEY'):
                try:
                    send_via_nvidia()
                    return
                except Exception as e:
                    self._json(500, {"error": {"message": f"NVIDIA NIM Chat Error: {e}"}})
            else:
                self._json(500, {"error": {"message": "No valid API key available."}})
        elif self.path == '/api/welcome':
            # Called when onboarding completes. Idempotent: the signup grant is
            # issued once per user id, and first_time is true only the first
            # time it is claimed, so the notification cannot be farmed.
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length)
            try:
                d = json.loads(raw or b'{}')
            except Exception:
                d = {}
            uid = self._identify(d)
            first = LEDGER.claim_welcome(uid)
            w = LEDGER.wallet(uid)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self._set_uid_cookie()
            self.end_headers()
            self.wfile.write(json.dumps({
                "first_time": first,
                "credits": noura_meter.SIGNUP_GRANT,
                "balance": w['balance'],
                "actions_left": w['balance'] // noura_meter.CREDIT_COST
                                if noura_meter.CREDIT_COST else 0,
                "cost_per_action": noura_meter.CREDIT_COST,
            }).encode('utf-8'))
        elif self.path == '/api/admin/grant':
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length)
            if not self._admin_ok():
                self._json(403, {"error": "admin token required"})
                return
            try:
                g = json.loads(raw or b'{}')
            except Exception:
                g = {}
            uid = (g.get('user_id') or '').strip()
            try:
                amount = int(g.get('credits', 0))
            except Exception:
                amount = 0
            reason = (g.get('reason') or 'admin').strip()
            if not uid or amount <= 0:
                self._json(400, {"error": "user_id and a positive credits amount are required"})
                return
            if reason not in noura_meter.GRANT_REASONS:
                self._json(400, {"error": "unknown reason",
                                 "allowed": sorted(noura_meter.GRANT_REASONS)})
                return
            res = LEDGER.grant(uid, amount, reason=reason, by='admin',
                               note=(g.get('note') or None))
            if not res:
                self._json(400, {"error": "grant rejected"})
                return
            self._json(200, res)
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
            req_model = data.get('model') or NVIDIA_TTS_MODEL
            req_func_id = TTS_FUNCTION_IDS.get(req_model) or TTS_FUNCTION_ID
            req_voice = data.get('voice') or TTS_DEFAULT_VOICES.get(req_model) or TTS_VOICE
            req_rate = TTS_DEFAULT_RATES.get(req_model) or TTS_RATE
            language = data.get('language') or 'en-US'
            tts_uid = self._identify(data)
            tts_surface = self._surface(data) if self._surface(data) != 'unknown' else 'tts'
            tts_allowed, tts_gate = self._gate(tts_uid, tts_surface)
            if not tts_allowed:
                self._json(402, tts_gate)
                return

            try:
                chunks = _split_for_tts(text)

                def _say(part):
                    global LAST_TTS_TIME
                    with TTS_LOCK:
                        now = time.time()
                        elapsed = now - LAST_TTS_TIME
                        if elapsed < 0.4:
                            time.sleep(0.4 - elapsed)
                        LAST_TTS_TIME = time.time()

                    delay = 0.4
                    for attempt in range(8):
                        try:
                            svc = riva.client.SpeechSynthesisService(_riva_auth(req_func_id))
                            return svc.synthesize(
                                text=part, voice_name=req_voice, language_code=language,
                                sample_rate_hz=req_rate,
                                encoding=riva.client.AudioEncoding.LINEAR_PCM).audio
                        except Exception as err:
                            err_str = str(err).lower()
                            if 'exceeded rate limit' in err_str or 'resource_exhausted' in err_str or '429' in err_str:
                                if attempt < 7:
                                    time.sleep(delay)
                                    delay *= 1.4
                                    continue
                            raise
                    raise RuntimeError('tts retries exhausted')

                pcm = b''.join(_say(c) for c in chunks)
                wav = pcm_to_wav(pcm, req_rate, 1)
                # Speech has no token concept, so bill by characters at a
                # configured rate. Estimated, not an invoiced figure.
                LEDGER.append(user_id=tts_uid, surface=tts_surface, provider='nvidia',
                              model=NVIDIA_TTS_MODEL, input_tokens=0, cache_read=0,
                              cache_write=0, output_tokens=0,
                              chars=len(text),
                              usd_cost=round(len(text) / 1000.0
                                             * noura_meter.TTS_USD_PER_1K_CHARS, 8),
                              usd_estimated=True,
                              credits=noura_meter.credit_cost(tts_surface))
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Access-Control-Allow-Origin', '*')
                self._set_uid_cookie()
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

    # ── admin surface ───────────────────────────────────────────────────
    def _admin_ok(self):
        """Token via header or ?key=. Defaults to noura123 if token in env is empty."""
        token = ADMIN_TOKEN or env_vars.get('NOURA_ADMIN_TOKEN', '') or 'noura123'
        supplied = self.headers.get('X-Noura-Admin') or ''
        if not supplied and '?' in self.path:
            from urllib.parse import urlparse, parse_qs
            supplied = (parse_qs(urlparse(self.path).query).get('key') or [''])[0]
        return secrets.compare_digest(supplied, token)

    def do_GET(self):
        path = self.path.split('?')[0]

        if path == '/api/admin/summary':
            if not self._admin_ok():
                self._json(403, {"error": "admin token required"})
                return
            since = noura_meter.period_start()
            org = LEDGER.org_totals(since)
            spend = org['usd']
            self._json(200, {
                "users": LEDGER.all_users(since),
                "org": org,
                "daily": LEDGER.daily_usd(30),
                "budget": {
                    # No API reports a remaining balance. This is OUR ceiling.
                    "ceiling_usd": MONTHLY_BUDGET_USD,
                    "spend_usd": spend,
                    "remaining_usd": (None if not MONTHLY_BUDGET_USD
                                      else round(MONTHLY_BUDGET_USD - spend, 4)),
                    "warn_pct": BUDGET_WARN_PCT,
                    "source": "local_ledger_against_configured_ceiling",
                },
                "config": {
                    "enforcement": CREDIT_ENFORCEMENT,
                    "admin_api_configured": bool(ANTHROPIC_ADMIN_KEY),
                    "period_start": since.isoformat(timespec='seconds').replace('+00:00', 'Z'),
                    "period_end": noura_meter.period_end().isoformat(
                        timespec='seconds').replace('+00:00', 'Z'),
                    "cost_per_action": noura_meter.CREDIT_COST,
                    "signup_grant": noura_meter.SIGNUP_GRANT,
                    "free_surfaces": sorted(noura_meter.FREE_SURFACES),
                    "grant_reasons": sorted(noura_meter.GRANT_REASONS),
                },
            })
            return

        if path == '/api/admin/reconcile':
            # Optional: compare our ledger against Anthropic's own report.
            if not self._admin_ok():
                self._json(403, {"error": "admin token required"})
                return
            if not ANTHROPIC_ADMIN_KEY:
                self._json(200, {"configured": False,
                                 "note": "Set ANTHROPIC_ADMIN_KEY to enable. "
                                         "Requires an organization account; the "
                                         "Admin API is unavailable for individual accounts."})
                return
            since = noura_meter.period_start()
            url = ('https://api.anthropic.com/v1/organizations/cost_report'
                   '?starting_at=%s&ending_at=%s'
                   % (since.strftime('%Y-%m-%dT%H:%M:%SZ'),
                      noura_meter.period_end().strftime('%Y-%m-%dT%H:%M:%SZ')))
            try:
                req = urllib.request.Request(url, headers={
                    'x-api-key': ANTHROPIC_ADMIN_KEY,
                    'anthropic-version': '2023-06-01',
                    'User-Agent': 'Noura/1.0 (usage-reconciliation)',
                })
                with urllib.request.urlopen(req, timeout=20) as r:
                    report = json.loads(r.read().decode('utf-8'))
                reported = 0.0
                for bucket in report.get('data', []):
                    for item in bucket.get('results', []):
                        try:
                            reported += float(item.get('amount', 0)) / 100.0
                        except Exception:
                            pass
                ours = LEDGER.org_totals(since)['usd']
                self._json(200, {"configured": True, "anthropic_usd": round(reported, 4),
                                 "ledger_usd": ours,
                                 "delta_usd": round(reported - ours, 4)})
            except Exception as e:
                self._json(200, {"configured": True, "error": str(e)[:200]})
            return

        if path == '/api/me':
            uid = self._identify()
            w = LEDGER.wallet(uid)
            unlimited = noura_meter.is_unlimited(LEDGER.user(uid))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self._set_uid_cookie()
            self.end_headers()
            self.wfile.write(json.dumps({
                "user_id": uid,
                # Unlimited accounts report a null balance rather than a
                # negative one; the UI renders that as an infinity symbol.
                "unlimited": unlimited,
                "balance": None if unlimited else w['balance'],
                "granted": w['granted'],
                "spent": w['spent'],
                "cost_per_action": noura_meter.CREDIT_COST,
                "actions_left": None if unlimited else (
                    w['balance'] // noura_meter.CREDIT_COST
                    if noura_meter.CREDIT_COST else 0),
                # Credits never expire, so there is no reset date.
                "expires": None,
            }).encode('utf-8'))
            return

        # Clean URL handling — support routes without .html extension
        if not path.startswith('/api/'):
            if path in ('/admin', '/admin.html') and not self._admin_ok():
                self._json(403, {"error": "admin token required",
                                 "hint": "open /admin?key=YOUR_NOURA_ADMIN_TOKEN"})
                return

            p_lower = path.lower()
            if p_lower in ('/chat', '/chat.html', '/chatbot', '/chatbot.html'):
                self.path = '/chatbot.html'
            elif p_lower in ('/create', '/create.html', '/create-course', '/create-course.html'):
                self.path = '/create-course.html'
            elif p_lower == '/dashboard':
                self.path = '/chatbot.html'
            elif p_lower == '/dashboard.html':
                self.path = '/dashboard.html'
            else:
                rel = path.lstrip('/')
                if rel and not os.path.exists(rel) and not os.path.isdir(rel):
                    if os.path.exists(rel + '.html'):
                        self.path = '/' + rel + '.html'

        return http.server.SimpleHTTPRequestHandler.do_GET(self)

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
