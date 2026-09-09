import os
import sys
import json
import struct
import urllib.request
import urllib.error
import urllib.parse
import secrets
import time
import threading
from http.server import BaseHTTPRequestHandler

# Add root directory to sys.path so noura_meter can be imported
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    import noura_meter
    from noura_meter import LEDGER
except Exception:
    noura_meter = None
    LEDGER = None

try:
    import stripe
except ImportError:
    stripe = None

# Read environment variables (from os.environ or fallback to local .env.local)
env_vars = dict(os.environ)
env_path = os.path.join(ROOT_DIR, '.env.local')
if os.path.exists(env_path):
    try:
        with open(env_path, 'r') as f:
            for line in f:
                if line.strip() and not line.startswith('#') and '=' in line:
                    k, v = line.strip().split('=', 1)
                    if k not in env_vars or not env_vars[k]:
                        env_vars[k] = v.strip("'\"")
    except Exception:
        pass

STRIPE_SECRET_KEY = env_vars.get('STRIPE_SECRET_KEY', '')
if stripe and STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

NVIDIA_API_KEY = env_vars.get('NVIDIA_API_KEY', '')
ANTHROPIC_API_KEY = env_vars.get('ANTHROPIC_API_KEY', '')
ADMIN_TOKEN = env_vars.get('NOURA_ADMIN_TOKEN', '').strip()
ANTHROPIC_ADMIN_KEY = env_vars.get('ANTHROPIC_ADMIN_KEY', '').strip()
MONTHLY_BUDGET_USD = float(env_vars.get('NOURA_MONTHLY_BUDGET_USD', '') or 0) or None
BUDGET_WARN_PCT = float(env_vars.get('NOURA_BUDGET_WARN_PCT', '') or 80)
CREDIT_ENFORCEMENT = (env_vars.get('NOURA_CREDIT_ENFORCEMENT', '') or 'log_only').lower()

_SECRET_HINTS = ('KEY', 'SECRET', 'TOKEN', 'PASSWORD')
public_env = {k: v for k, v in env_vars.items() if not any(h in k.upper() for h in _SECRET_HINTS)}

sb_url = env_vars.get('SUPABASE_URL', '').strip()
sb_anon = (env_vars.get('SUPABASE_ANON_KEY', '') or env_vars.get('SUPABASE_KEY', '')).strip()

# ── NVIDIA Riva TTS Setup ──────────────────────────────────────────────
try:
    import riva.client
    RIVA_AVAILABLE = True
except Exception:
    RIVA_AVAILABLE = False

RIVA_URI = 'grpc.nvcf.nvidia.com:443'
TTS_FUNCTION_IDS = {
    'magpie-tts-multilingual': '877104f7-e885-42b9-8de8-f6e4c6303969',
    'chatterbox-multilingual-tts': env_vars.get('NVIDIA_TTS_FUNCTION_ID', '') or 'ddacc747-1269-4fab-bfd9-8f593dead106',
}
TTS_DEFAULT_VOICES = {
    'magpie-tts-multilingual': 'Magpie-Multilingual.EN-US.Sofia',
    'chatterbox-multilingual-tts': 'Chatterbox-Multilingual.en-US.Male',
}
TTS_DEFAULT_RATES = {
    'magpie-tts-multilingual': 44100,
    'chatterbox-multilingual-tts': 24000,
}
TTS_DEFAULT_LIMITS = {
    'magpie-tts-multilingual': 700,
    'chatterbox-multilingual-tts': 350,
}
TTS_LOCK = threading.Lock()
LAST_TTS_TIME = 0.0

def _riva_auth(function_id, api_key):
    return riva.client.Auth(None, True, RIVA_URI,
                            [['function-id', function_id],
                             ['authorization', 'Bearer ' + api_key]])

def pcm_to_wav(pcm, rate, channels=1, bits=16):
    byte_rate = rate * channels * bits // 8
    block_align = channels * bits // 8
    data_len = len(pcm)
    header = (b'RIFF' + struct.pack('<I', 36 + data_len) + b'WAVE'
              + b'fmt ' + struct.pack('<IHHIIHH', 16, 1, channels, rate, byte_rate, block_align, bits)
              + b'data' + struct.pack('<I', data_len))
    return header + pcm

def _split_for_tts(text, limit=350):
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

if 'dashboard/project/' in sb_url:
    import re
    m = re.search(r'dashboard/project/([a-zA-Z0-9_-]+)', sb_url)
    if m:
        sb_url = f'https://{m.group(1)}.supabase.co'
elif not sb_url and sb_anon:
    try:
        import base64
        parts = sb_anon.split('.')
        if len(parts) >= 2:
            payload = json.loads(base64.b64decode(parts[1] + '===').decode('utf-8'))
            if payload.get('ref'):
                sb_url = f"https://{payload['ref']}.supabase.co"
    except Exception:
        pass


class RateLimiter:
    """In-memory sliding window rate limiter for abuse prevention."""
    def __init__(self):
        self._lock = threading.Lock()
        self._buckets = {}

    def is_allowed(self, key: str, max_requests: int, window_seconds: int = 60):
        now = time.time()
        with self._lock:
            timestamps = self._buckets.get(key, [])
            cutoff = now - window_seconds
            valid = [t for t in timestamps if t > cutoff]
            if len(valid) >= max_requests:
                retry_after = max(1, int(cutoff + window_seconds - now))
                self._buckets[key] = valid
                return False, retry_after
            valid.append(now)
            self._buckets[key] = valid
            if len(self._buckets) > 5000:
                self._buckets = {k: v for k, v in self._buckets.items() if v and v[-1] > cutoff}
            return True, 0


RATE_LIMITER = RateLimiter()


def fetch_supabase_auth_users():
    """Fetch registered users from Supabase Auth admin API if key is available."""
    sb_url_raw = env_vars.get('SUPABASE_URL', '').strip()
    if 'dashboard/project/' in sb_url_raw:
        import re
        m = re.search(r'dashboard/project/([a-zA-Z0-9_-]+)', sb_url_raw)
        if m:
            sb_url_raw = f'https://{m.group(1)}.supabase.co'
    sb_url = sb_url_raw.rstrip('/')
    service_key = (
        env_vars.get('SUPABASE_SERVICE_ROLE_KEY', '') or 
        env_vars.get('SUPABASE_SERVICE_KEY', '') or 
        env_vars.get('SUPABASE_SECRET_KEY', '') or 
        env_vars.get('SUPABASE_ADMIN_KEY', '') or
        env_vars.get('SUPABASE_ANON_KEY', '')
    ).strip()

    if not sb_url or not service_key:
        return [], False, "SUPABASE_SERVICE_ROLE_KEY not configured in .env.local / environment."

    try:
        url = f'{sb_url}/auth/v1/admin/users?per_page=1000'
        req = urllib.request.Request(url, headers={
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'application/json'
        })
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            raw_users = data.get('users', [])
            result = []
            for u in raw_users:
                email = (u.get('email') or '').strip().lower()
                meta = u.get('user_metadata') or {}
                name = (meta.get('full_name') or meta.get('name') or (email.split('@')[0] if email else 'User')).strip()
                tier = meta.get('tier') or meta.get('plan') or ('unlimited' if meta.get('unlimited') else 'free')
                result.append({
                    'supabase_id': u.get('id'),
                    'email': email,
                    'name': name,
                    'tier': tier,
                    'credits': meta.get('credits'),
                    'unlimited': bool(meta.get('unlimited') or tier == 'unlimited'),
                    'created_at': u.get('created_at'),
                    'last_sign_in_at': u.get('last_sign_in_at'),
                    'provider': u.get('app_metadata', {}).get('provider', 'email')
                })
            return result, True, None
    except Exception as e:
        return [], False, str(e)


def update_supabase_user(user_id, metadata):
    """Persist user tier/plan/credits permanently to Supabase auth user_metadata."""
    sb_url_raw = env_vars.get('SUPABASE_URL', '').strip()
    if 'dashboard/project/' in sb_url_raw:
        import re
        m = re.search(r'dashboard/project/([a-zA-Z0-9_-]+)', sb_url_raw)
        if m:
            sb_url_raw = f'https://{m.group(1)}.supabase.co'
    sb_url = sb_url_raw.rstrip('/')
    service_key = (
        env_vars.get('SUPABASE_SERVICE_ROLE_KEY', '') or 
        env_vars.get('SUPABASE_SERVICE_KEY', '') or 
        env_vars.get('SUPABASE_SECRET_KEY', '') or 
        env_vars.get('SUPABASE_ADMIN_KEY', '') or
        env_vars.get('SUPABASE_ANON_KEY', '')
    ).strip()

    if not sb_url or not service_key or not user_id:
        return False

    try:
        url = f'{sb_url}/auth/v1/admin/users/{user_id}'
        req = urllib.request.Request(url, data=json.dumps({'user_metadata': metadata}).encode('utf-8'), headers={
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'application/json'
        }, method='PUT')
        with urllib.request.urlopen(req, timeout=8) as resp:
            return True
    except Exception:
        return False


class handler(BaseHTTPRequestHandler):
    def _client_ip(self):
        xff = self.headers.get('X-Forwarded-For')
        if xff:
            return xff.split(',')[0].strip()
        return self.headers.get('X-Real-IP') or (self.client_address[0] if hasattr(self, 'client_address') and self.client_address else 'unknown')

    def _allowed_origin(self):
        origin = (self.headers.get('Origin') or '').strip()
        if not origin:
            return '*'
        try:
            parsed = urllib.parse.urlparse(origin)
            host = (parsed.hostname or '').lower()
            if host in ('localhost', '127.0.0.1', 'noura.study') or host.endswith('.vercel.app') or host.endswith('.teachloop.app') or host.endswith('.noura.ai') or host.endswith('.noura.study'):
                return origin
        except Exception:
            pass
        return '*'

    def _security_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')

    def _json(self, code, payload, headers=None):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', self._allowed_origin())
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Noura-Admin, X-Noura-Surface, X-Noura-Email, X-Sample-Rate, X-Language')
        self._security_headers()
        self.send_header('Content-Length', str(len(body)))
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _audio_wav(self, wav_bytes):
        self.send_response(200)
        self.send_header('Content-Type', 'audio/wav')
        self.send_header('Access-Control-Allow-Origin', self._allowed_origin())
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Noura-Admin, X-Noura-Surface, X-Noura-Email')
        self._security_headers()
        self.send_header('Content-Length', str(len(wav_bytes)))
        self.end_headers()
        self.wfile.write(wav_bytes)

    def _cors(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self._allowed_origin())
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Noura-Admin, X-Noura-Surface, X-Noura-Email, X-Sample-Rate, X-Language')
        self._security_headers()
        self.end_headers()

    def do_OPTIONS(self):
        self._cors()

    def _admin_ok(self):
        if not ADMIN_TOKEN:
            return False
        supplied = self.headers.get('X-Noura-Admin') or ''
        if not supplied and '?' in self.path:
            supplied = (urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('key') or [''])[0]
        return bool(supplied and secrets.compare_digest(supplied, ADMIN_TOKEN))

    def _identify(self, body_dict=None):
        email = (self.headers.get('X-Noura-Email') or '').strip().lower()
        if not email and body_dict and isinstance(body_dict, dict):
            email = (body_dict.get('email') or '').strip().lower()
        
        cookie_uid = None
        if noura_meter:
            cookie_uid = noura_meter.parse_cookie_uid(self.headers.get('Cookie'))
        
        if email and '@' in email and LEDGER:
            existing = LEDGER.find_user_by_email(email)
            if existing:
                return existing
            uid = cookie_uid or ('usr_' + secrets.token_hex(8))
            LEDGER.ensure_user(uid, email=email)
            return uid
        if cookie_uid:
            return cookie_uid
        if noura_meter:
            return noura_meter.new_user_id()
        return 'usr_' + secrets.token_hex(8)

    def _check_credit_gate(self, uid, data=None):
        if not LEDGER:
            return True, 500
        surface = self.headers.get('X-Noura-Surface') or (data.get('_noura_surface') if isinstance(data, dict) else None) or (data.get('surface') if isinstance(data, dict) else None) or (data.get('reason') if isinstance(data, dict) else None) or 'unknown'
        u = LEDGER.user(uid)
        email = (self.headers.get('X-Noura-Email') or (data.get('email') if isinstance(data, dict) else None) or u.get('email') or '').strip().lower()
        unlimited = (email == 'prorkrff@gmail.com') or (noura_meter.is_unlimited(u) if noura_meter else False)
        if unlimited:
            return True, 999999
        cost = noura_meter.credit_cost(surface) if noura_meter else 100
        if cost == 0:
            return True, 500
        w = LEDGER.wallet(uid)
        bal = w.get('balance', 500)
        if bal < cost and w.get('spent', 0) > 0:
            return False, bal
        return True, bal

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == '/config.js':
                self._js(200, f'const ENV = {json.dumps(public_env)};\n')
                return

            if path == '/supabase-config.js':
                self._js(200, f'window.SUPABASE_URL = "{sb_url}";\nwindow.SUPABASE_ANON_KEY = "{sb_anon}";\n')
                return

            if path in ('/api/me', '/api/credits'):
                email = (self.headers.get('X-Noura-Email') or '').strip().lower()
                uid = self._identify()
                if LEDGER:
                    try:
                        LEDGER.ensure_user(uid, email=email)
                        w = LEDGER.wallet(uid)
                        u = LEDGER.user(uid)
                        # If tier is free in local LEDGER but Pro/Unlimited in Supabase metadata, restore it
                        if u.get('tier', 'free') == 'free' and email:
                            sb_users, _, _ = fetch_supabase_auth_users()
                            for sbu in sb_users:
                                if sbu.get('email') == email:
                                    s_tier = sbu.get('tier') or ('unlimited' if sbu.get('unlimited') else None)
                                    if s_tier and s_tier != 'free':
                                        LEDGER.set_tier(uid, s_tier)
                                        u = LEDGER.user(uid)
                                        w = LEDGER.wallet(uid)
                                    break
                    except Exception:
                        w = {'balance': 500, 'granted': 500, 'spent': 0}
                        u = {'email': email}
                else:
                    w = {'balance': 500, 'granted': 500, 'spent': 0}
                    u = {'email': email}
                cost = noura_meter.CREDIT_COST if noura_meter else 100
                user_email = (u.get('email') or email or '').strip().lower()
                unlimited = (user_email == 'prorkrff@gmail.com') or (u.get('tier') == 'unlimited') or (noura_meter.is_unlimited(u) if noura_meter else False)
                bal = w.get('balance', 500)
                if bal == 0 and w.get('spent', 0) == 0:
                    bal = 500
                
                self._json(200, {
                    "user_id": uid,
                    "email": user_email or None,
                    "tier": "unlimited" if unlimited else u.get('tier', 'free'),
                    "balance": None if unlimited else bal,
                    "unlimited": unlimited,
                    "actions_left": 999999 if unlimited else (bal // cost if cost else 0),
                    "cost_per_action": cost,
                    "granted": max(w.get('granted', 500), 500),
                    "spent": 0 if unlimited else w.get('spent', 0),
                    "expires": None,
                })
                return

            if path == '/api/ping':
                self._json(200, {"status": "ok", "app": "Noura", "time": int(time.time())})
                return

            if path == '/api/admin/summary':
                if not self._admin_ok():
                    self._json(403, {"error": "admin token required or NOURA_ADMIN_TOKEN not configured"})
                    return
                if not LEDGER:
                    self._json(500, {"error": "Ledger unavailable"})
                    return
                
                # Sync Supabase registered users into Ledger if available
                sb_users, sb_ok, sb_note = fetch_supabase_auth_users()
                if sb_users:
                    for sbu in sb_users:
                        if sbu.get('email'):
                            existing_uid = LEDGER.find_user_by_email(sbu['email'])
                            uid = existing_uid or sbu.get('supabase_id') or ('usr_' + secrets.token_hex(8))
                            LEDGER.ensure_user(uid, email=sbu['email'])
                            s_tier = sbu.get('tier') or ('unlimited' if sbu.get('unlimited') else None)
                            if s_tier and s_tier != 'free':
                                LEDGER.set_tier(uid, s_tier)

                since = noura_meter.period_start() if noura_meter else None
                org = LEDGER.org_totals(since)
                spend = org['usd']
                self._json(200, {
                    "users": LEDGER.all_users(since),
                    "org": org,
                    "daily": LEDGER.daily_usd(30),
                    "supabase_sync": {
                        "active": sb_ok,
                        "count": len(sb_users),
                        "note": sb_note
                    },
                    "budget": {
                        "ceiling_usd": MONTHLY_BUDGET_USD,
                        "spend_usd": spend,
                        "remaining_usd": (None if not MONTHLY_BUDGET_USD else round(MONTHLY_BUDGET_USD - spend, 4)),
                        "warn_pct": BUDGET_WARN_PCT,
                        "source": "local_ledger_against_configured_ceiling",
                    },
                    "config": {
                        "enforcement": CREDIT_ENFORCEMENT,
                        "admin_api_configured": bool(ANTHROPIC_ADMIN_KEY),
                        "period_start": since.isoformat(timespec='seconds').replace('+00:00', 'Z') if since else None,
                        "cost_per_action": noura_meter.CREDIT_COST if noura_meter else 100,
                        "signup_grant": noura_meter.SIGNUP_GRANT if noura_meter else 500,
                        "free_surfaces": sorted(noura_meter.FREE_SURFACES) if noura_meter else [],
                    },
                })
                return

            self._json(404, {"error": "Not found", "path": path})
        except Exception as e:
            self._json(500, {"error": {"message": "An internal server error occurred."}})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get('Content-Length', 0))
        raw_body = self.rfile.read(length) if length > 0 else b'{}'
        ip = self._client_ip()
        
        try:
            data = json.loads(raw_body.decode('utf-8')) if raw_body else {}
        except Exception:
            try:
                data = {k: v[0] for k, v in urllib.parse.parse_qs(raw_body.decode('utf-8')).items()}
            except Exception:
                data = {}

        if path == '/api/admin/grant':
            if not self._admin_ok():
                self._json(403, {"error": "admin token required"})
                return
            target = (data.get('user_id') or data.get('email') or '').strip()
            try:
                amount = int(data.get('credits', 0))
            except Exception:
                amount = 0
            reason = (data.get('reason') or 'admin').strip()
            if not target or amount <= 0:
                self._json(400, {"error": "user_id or email, and a positive credit amount are required"})
                return
            if not LEDGER:
                self._json(500, {"error": "Ledger unavailable"})
                return
            res = LEDGER.grant(target, amount, reason=reason, by='admin', note=data.get('note'))
            if not res:
                self._json(400, {"error": "Grant failed"})
                return
            self._json(200, res)
            return

        elif path == '/api/admin/deduct':
            if not self._admin_ok():
                self._json(403, {"error": "admin token required"})
                return
            target = (data.get('user_id') or data.get('email') or '').strip()
            try:
                amount = int(data.get('credits', 0))
            except Exception:
                amount = 0
            reason = (data.get('reason') or 'admin_deduct').strip()
            if not target or amount <= 0:
                self._json(400, {"error": "user_id or email, and a positive credit amount are required"})
                return
            if not LEDGER:
                self._json(500, {"error": "Ledger unavailable"})
                return
            res = LEDGER.deduct(target, amount, reason=reason, by='admin', note=data.get('note'))
            if not res:
                self._json(400, {"error": "Deduct failed"})
                return
            self._json(200, res)
            return

        elif path in ('/api/admin/set-tier', '/api/admin/plan'):
            if not self._admin_ok():
                self._json(403, {"error": "admin token required"})
                return
            target = (data.get('user_id') or data.get('email') or '').strip()
            tier = str(data.get('tier') or data.get('plan') or 'free').strip().lower()
            if not target:
                self._json(400, {"error": "user_id or email is required"})
                return
            valid_tiers = ('free', 'pro', 'unlimited')
            if tier not in valid_tiers:
                self._json(400, {"error": f"Invalid tier. Allowed: {valid_tiers}"})
                return
            if not LEDGER:
                self._json(500, {"error": "Ledger unavailable"})
                return
            res = LEDGER.set_tier(target, tier)
            # Sync permanently to Supabase auth metadata
            try:
                sb_users, _, _ = fetch_supabase_auth_users()
                for sbu in sb_users:
                    if (sbu.get('email') == target.lower() or sbu.get('supabase_id') == target) and sbu.get('supabase_id'):
                        update_supabase_user(sbu['supabase_id'], {
                            'tier': tier,
                            'plan': tier,
                            'unlimited': (tier == 'unlimited')
                        })
            except Exception:
                pass
            self._json(200, {"success": True, "user": res, "tier": tier})
            return

        elif path in ('/api/cancel-subscription', '/api/stripe/cancel'):
            email = (data.get('email') or self.headers.get('X-Noura-Email') or '').strip().lower()
            uid = self._identify(data)
            if LEDGER:
                try:
                    LEDGER.set_tier(uid, 'free')
                except Exception:
                    pass
            # Update Supabase user metadata permanently
            try:
                sb_users, _, _ = fetch_supabase_auth_users()
                for sbu in sb_users:
                    if (sbu.get('email') == email or sbu.get('supabase_id') == uid) and sbu.get('supabase_id'):
                        update_supabase_user(sbu['supabase_id'], {'tier': 'free', 'plan': 'free', 'unlimited': False})
            except Exception:
                pass
            self._json(200, {"success": True, "message": "Subscription cancelled. Reverted to Free plan.", "tier": "free"})
            return

        elif path in ('/create-checkout-session', '/api/create-checkout-session'):
            allowed, retry = RATE_LIMITER.is_allowed(f"checkout_{ip}", max_requests=8, window_seconds=60)
            if not allowed:
                self._json(429, {"error": "rate_limit_exceeded", "message": "Too many checkout requests. Please wait a moment."}, headers={'Retry-After': str(retry)})
                return

            if not stripe:
                self._json(500, {'error': {'message': 'Stripe library not initialized'}})
                return

            plan = str(data.get('plan') or 'pro').lower()
            period = str(data.get('period') or 'monthly').lower()
            email = (data.get('email') or '').strip()

            prices = {
                'pro': {
                    'monthly': 800,   # $8.00 USD
                    'yearly': 7700,   # $77.00 USD
                    'name': 'Noura Pro'
                },
                'unlimited': {
                    'monthly': 1500,  # $15.00 USD
                    'yearly': 14400,  # $144.00 USD
                    'name': 'Noura Unlimited'
                }
            }

            plan_info = prices.get(plan, prices['pro'])
            unit_amount = plan_info.get(period, plan_info['monthly'])
            interval = 'year' if period == 'yearly' else 'month'

            host = self.headers.get('Host', 'localhost:3006')
            proto = 'https' if self.headers.get('X-Forwarded-Proto') == 'https' else 'http'
            domain = f"{proto}://{host}"

            session_params = {
                'payment_method_types': ['card'],
                'line_items': [{
                    'price_data': {
                        'currency': 'usd',
                        'product_data': {
                            'name': f"{plan_info['name']} ({period.capitalize()})",
                            'description': 'Full access to Noura learning intelligence and study assistant',
                        },
                        'unit_amount': unit_amount,
                        'recurring': {
                            'interval': interval,
                        },
                    },
                    'quantity': 1,
                }],
                'mode': 'subscription',
                'success_url': domain + '/chatbot.html?session_id={CHECKOUT_SESSION_ID}&upgraded=true',
                'cancel_url': domain + '/chatbot.html',
            }
            if email and '@' in email:
                session_params['customer_email'] = email

            try:
                checkout_session = stripe.checkout.Session.create(**session_params)
                self._json(200, {'url': checkout_session.url, 'id': checkout_session.id})
            except Exception as e:
                self._json(400, {'error': {'message': 'Checkout session creation failed. Please try again.'}})
            return

        elif path == '/create-portal-session':
            if not stripe:
                self._json(500, {'error': {'message': 'Stripe library not initialized'}})
                return

            session_id = data.get('session_id')
            host = self.headers.get('Host', 'localhost:3006')
            proto = 'https' if self.headers.get('X-Forwarded-Proto') == 'https' else 'http'
            domain = f"{proto}://{host}"

            try:
                customer_id = None
                if session_id:
                    sess = stripe.checkout.Session.retrieve(session_id)
                    customer_id = sess.customer
                
                if not customer_id:
                    self._json(400, {'error': {'message': 'Customer ID not found for portal'}})
                    return

                portal_session = stripe.billing_portal.Session.create(
                    customer=customer_id,
                    return_url=domain + '/chatbot.html'
                )
                self._json(200, {'url': portal_session.url})
            except Exception as e:
                self._json(400, {'error': {'message': 'Billing portal could not be loaded.'}})
            return

        elif path == '/webhook':
            sig_header = self.headers.get('Stripe-Signature')
            webhook_secret = env_vars.get('STRIPE_WEBHOOK_SECRET', '')
            try:
                if stripe and webhook_secret and sig_header:
                    event = stripe.Webhook.construct_event(raw_body, sig_header, webhook_secret)
                else:
                    event = json.loads(raw_body.decode('utf-8') or '{}')
                self._json(200, {'status': 'success'})
            except Exception as e:
                self._json(400, {'error': 'Webhook signature verification failed'})
            return

        elif path == '/api/welcome':
            uid = self._identify(data)
            first = LEDGER.claim_welcome(uid) if LEDGER else True
            w = LEDGER.wallet(uid) if LEDGER else {'balance': 500}
            cost = noura_meter.CREDIT_COST if noura_meter else 100
            grant = noura_meter.SIGNUP_GRANT if noura_meter else 500
            bal = w.get('balance', 500)
            self._json(200, {
                "first_time": first,
                "credits": grant,
                "balance": bal,
                "actions_left": bal // cost if cost else 0,
                "cost_per_action": cost,
            })
            return

        elif path in ('/api/spend', '/api/deduct'):
            email = (self.headers.get('X-Noura-Email') or data.get('email') or '').strip().lower()
            uid = self._identify(data)
            cost = int(data.get('amount') or data.get('cost') or 100)
            reason = str(data.get('reason') or data.get('surface') or 'lesson_generation')
            unlimited = (email == 'prorkrff@gmail.com')
            if LEDGER:
                LEDGER.ensure_user(uid, email=email)
                u = LEDGER.user(uid)
                if not unlimited:
                    unlimited = (u.get('email', '').strip().lower() == 'prorkrff@gmail.com') or (noura_meter.is_unlimited(u) if noura_meter else False)
                if not unlimited:
                    LEDGER.append(
                        user_id=uid,
                        kind='spend',
                        surface=reason,
                        provider='app',
                        model=None,
                        input_tokens=0,
                        cache_read=0,
                        cache_write=0,
                        output_tokens=0,
                        usd_cost=0.0,
                        credits=cost,
                        reason=reason
                    )
                w = LEDGER.wallet(uid)
                bal = w.get('balance', 500)
            else:
                bal = 500 if unlimited else max(0, 500 - cost)
                w = {'balance': bal, 'granted': 500, 'spent': 0 if unlimited else cost}

            self._json(200, {
                "success": True,
                "user_id": uid,
                "deducted": 0 if unlimited else cost,
                "balance": None if unlimited else bal,
                "unlimited": unlimited,
                "granted": w.get('granted', 500),
                "spent": 0 if unlimited else w.get('spent', 0),
                "actions_left": 999999 if unlimited else (bal // 100 if bal >= 0 else 0),
                "cost_per_action": 100
            })
            return

        elif path in ('/api/chat', '/v1/messages', '/api/messages'):
            uid = self._identify(data)
            rate_key = f"chat_{uid}_{ip}"
            allowed, retry = RATE_LIMITER.is_allowed(rate_key, max_requests=30, window_seconds=60)
            if not allowed:
                self._json(429, {"error": "rate_limit_exceeded", "message": "Too many requests. Please wait a moment before sending another message."}, headers={'Retry-After': str(retry)})
                return

            credit_ok, current_bal = self._check_credit_gate(uid, data)
            if not credit_ok:
                self._json(402, {
                    "error": "insufficient_credits",
                    "message": "You have exhausted your available study credits. Please upgrade your plan to continue.",
                    "balance": current_bal
                })
                return

            anthropic_key = env_vars.get('ANTHROPIC_API_KEY', '') or ANTHROPIC_API_KEY
            nv_key = env_vars.get('NVIDIA_API_KEY', '') or NVIDIA_API_KEY

            # Model normalization to working production IDs
            model_req = str(data.get('model') or '')
            if 'haiku' in model_req.lower():
                data['model'] = 'claude-haiku-4-5-20251001'
            elif 'sonnet' in model_req.lower():
                data['model'] = 'claude-sonnet-4-5-20250929'
            elif 'opus' in model_req.lower():
                data['model'] = 'claude-opus-4-5-20251101'
            elif not model_req.startswith('claude-'):
                data['model'] = 'claude-haiku-4-5-20251001'

            # Clean client-specific tool fields
            if 'tools' in data and isinstance(data['tools'], list):
                data['tools'] = [t for t in data['tools'] if t.get('type') != 'web_search_20250305']
                if not data['tools']:
                    del data['tools']

            # Try Anthropic Claude
            if anthropic_key:
                try:
                    if 'system' in data and data['system']:
                        if isinstance(data['system'], list):
                            data['system'] = "\n\n".join([x.get('text', '') if isinstance(x, dict) else str(x) for x in data['system']])

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
                    with urllib.request.urlopen(anth_req, timeout=18) as resp:
                        resp_bytes = resp.read()
                        if LEDGER and noura_meter:
                            try:
                                resp_obj = json.loads(resp_bytes.decode('utf-8'))
                                u_data = resp_obj.get('usage', {})
                                in_tok = int(u_data.get('input_tokens', 0) or 0)
                                out_tok = int(u_data.get('output_tokens', 0) or 0)
                                c_read = int(u_data.get('cache_read_input_tokens', 0) or 0)
                                c_write = int(u_data.get('cache_creation_input_tokens', 0) or 0)
                                m_name = data.get('model', 'claude-haiku-4-5-20251001')
                                usd = noura_meter.token_cost(m_name, in_tok, c_read, c_write, out_tok)
                                LEDGER.append(
                                    user_id=uid, surface='chat', provider='anthropic',
                                    model=m_name, input_tokens=in_tok,
                                    cache_read=c_read, cache_write=c_write,
                                    output_tokens=out_tok, usd_cost=usd,
                                    credits=100
                                )
                            except Exception as rec_err:
                                print(f"[chat] Metering record error: {rec_err}")
                        self.send_response(200)
                        self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                        self.send_header('Access-Control-Allow-Origin', self._allowed_origin())
                        self._security_headers()
                        self.end_headers()
                        self.wfile.write(resp_bytes)
                        return
                except Exception as e:
                    print(f"[chat] Anthropic fallback: {e}")

            # Fallback response if Anthropic unavailable
            if nv_key:
                try:
                    sys_prompt = data.get("system", "")
                    msgs = data.get("messages", [])
                    formatted_msgs = []
                    if sys_prompt:
                        formatted_msgs.append({"role": "system", "content": str(sys_prompt)})
                    for m in msgs:
                        content = m.get("content", "")
                        content_str = content if isinstance(content, str) else "\n\n".join([c.get("text", "") for c in content if isinstance(c, dict)])
                        formatted_msgs.append({"role": m.get("role", "user"), "content": content_str})

                    candidate_models = [
                        'deepseek-ai/deepseek-v4-flash-0731',
                        'meta/llama-3.1-8b-instruct'
                    ]
                    for chosen_model in candidate_models:
                        try:
                            req_body = json.dumps({
                                "model": chosen_model,
                                "messages": formatted_msgs,
                                "max_tokens": min(data.get("max_tokens", 800) or 800, 4000)
                            }).encode('utf-8')
                            req = urllib.request.Request(
                                'https://integrate.api.nvidia.com/v1/chat/completions',
                                data=req_body,
                                headers={
                                    'Authorization': f'Bearer {nv_key}',
                                    'Content-Type': 'application/json'
                                }
                            )
                            with urllib.request.urlopen(req, timeout=12) as resp:
                                resp_data = json.loads(resp.read().decode('utf-8'))
                                reply = resp_data.get('choices', [{}])[0].get('message', {}).get('content', '')
                                if reply:
                                    if LEDGER and noura_meter:
                                        usage = resp_data.get('usage', {})
                                        in_tok = int(usage.get('prompt_tokens') or (len(json.dumps(formatted_msgs)) // 4))
                                        out_tok = int(usage.get('completion_tokens') or (len(reply) // 4))
                                        usd = noura_meter.token_cost(chosen_model, in_tok, 0, 0, out_tok)
                                        LEDGER.append(
                                            user_id=uid, surface='chat', provider='nvidia',
                                            model=chosen_model, input_tokens=in_tok,
                                            cache_read=0, cache_write=0,
                                            output_tokens=out_tok, usd_cost=usd,
                                            credits=100
                                        )
                                    self._json(200, {
                                        "id": f"msg_{secrets.token_hex(8)}",
                                        "role": "assistant",
                                        "content": [{"type": "text", "text": reply}]
                                    })
                                    return
                        except Exception:
                            continue
                except Exception as e:
                    print(f"[chat] NVIDIA fallback error: {e}")

            self._json(500, {"error": {"message": "AI assistant is temporarily busy. Please retry in a few seconds."}})
            return

        elif path == '/api/tts':
            nv_key = env_vars.get('NVIDIA_API_KEY', '') or NVIDIA_API_KEY
            if not nv_key:
                self._json(503, {"error": "NVIDIA_API_KEY not configured"})
                return
            if not RIVA_AVAILABLE:
                self._json(503, {"error": "nvidia-riva-client not installed"})
                return

            text = (data.get('text') or '').strip()
            if not text:
                self._json(400, {"error": "missing text"})
                return

            req_model = data.get('model') or 'chatterbox-multilingual-tts'
            req_func_id = TTS_FUNCTION_IDS.get(req_model) or TTS_FUNCTION_IDS['chatterbox-multilingual-tts']
            req_voice = data.get('voice') or TTS_DEFAULT_VOICES.get(req_model) or TTS_DEFAULT_VOICES['chatterbox-multilingual-tts']
            req_rate = int(data.get('sample_rate') or TTS_DEFAULT_RATES.get(req_model) or 24000)
            req_limit = TTS_DEFAULT_LIMITS.get(req_model, 350)
            language = data.get('language') or 'en-US'

            try:
                chunks = _split_for_tts(text, req_limit)

                def _say(part):
                    global LAST_TTS_TIME
                    with TTS_LOCK:
                        now = time.time()
                        elapsed = now - LAST_TTS_TIME
                        if elapsed < 0.2:
                            time.sleep(0.2 - elapsed)
                        LAST_TTS_TIME = time.time()

                    delay = 0.3
                    for attempt in range(6):
                        try:
                            svc = riva.client.SpeechSynthesisService(_riva_auth(req_func_id, nv_key))
                            return svc.synthesize(
                                text=part,
                                voice_name=req_voice,
                                language_code=language,
                                sample_rate_hz=req_rate,
                                encoding=riva.client.AudioEncoding.LINEAR_PCM
                            ).audio
                        except Exception as err:
                            err_str = str(err).lower()
                            if ('exceeded rate limit' in err_str or 'resource_exhausted' in err_str or '429' in err_str) and attempt < 5:
                                time.sleep(delay)
                                delay *= 1.5
                                continue
                            raise
                    raise RuntimeError('TTS retries exhausted')

                pcm_chunks = []
                for c in chunks:
                    pcm_chunks.append(_say(c))
                pcm = b''.join(pcm_chunks)
                wav = pcm_to_wav(pcm, req_rate, 1)

                self._audio_wav(wav)
                return
            except Exception as e:
                print(f"[tts] NVIDIA Riva error: {e}")
                self._json(500, {"error": f"TTS synthesis failed: {str(e)}"})
                return

        elif path == '/api/generate-image':
            uid = self._identify(data)
            rate_key = f"img_{uid}_{ip}"
            allowed, retry = RATE_LIMITER.is_allowed(rate_key, max_requests=8, window_seconds=60)
            if not allowed:
                self._json(429, {"error": "rate_limit_exceeded", "message": "Image generation rate limit reached. Please wait a moment."}, headers={'Retry-After': str(retry)})
                return

            credit_ok, current_bal = self._check_credit_gate(uid, data)
            if not credit_ok:
                self._json(402, {
                    "error": "insufficient_credits",
                    "message": "You have exhausted your credits. Please upgrade your plan to generate images.",
                    "balance": current_bal
                })
                return

            nv_key = env_vars.get('NVIDIA_API_KEY', '') or NVIDIA_API_KEY
            prompt = (data.get('prompt') or '').strip()
            if not prompt:
                self._json(400, {"error": "missing prompt"})
                return

            if nv_key:
                try:
                    nv_url = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux-1-dev'
                    req_data = json.dumps({
                        "prompt": prompt,
                        "mode": "base",
                        "cfg_scale": 3.5,
                        "aspect_ratio": "1:1",
                        "steps": 25
                    }).encode('utf-8')
                    req = urllib.request.Request(
                        nv_url,
                        data=req_data,
                        headers={'Authorization': f'Bearer {nv_key}', 'Content-Type': 'application/json', 'Accept': 'application/json'},
                        method='POST'
                    )
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        resp_json = json.loads(resp.read().decode('utf-8'))
                        b64_str = None
                        if isinstance(resp_json, dict):
                            if 'artifacts' in resp_json and len(resp_json['artifacts']) > 0:
                                b64_str = resp_json['artifacts'][0].get('base64')
                            elif 'b64_json' in resp_json:
                                b64_str = resp_json['b64_json']
                            elif 'image' in resp_json:
                                b64_str = resp_json['image']
                        if b64_str:
                            if LEDGER:
                                LEDGER.append(
                                    user_id=uid, surface='generate-image', provider='nvidia',
                                    model='black-forest-labs/flux-1-dev', input_tokens=0,
                                    cache_read=0, cache_write=0, output_tokens=0,
                                    usd_cost=0.025, credits=100
                                )
                            img_url = b64_str if b64_str.startswith('data:') else f"data:image/png;base64,{b64_str}"
                            self._json(200, {"image_url": img_url})
                            return
                except Exception as e:
                    print(f"[generate-image] NVIDIA FLUX error: {e}")

            # Fallback illustration
            self._json(200, {"image_url": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'><rect width='600' height='400' fill='%2318181b' rx='16'/><text x='300' y='200' fill='%23a855f7' font-family='sans-serif' font-size='18' text-anchor='middle'>Noura Concept Diagram</text></svg>"})
            return

        elif path == '/api/stt':
            rate_key = f"stt_{ip}"
            allowed, retry = RATE_LIMITER.is_allowed(rate_key, max_requests=20, window_seconds=60)
            if not allowed:
                self._json(429, {"error": "rate_limit_exceeded", "message": "Voice transcription limit reached. Please wait a moment."}, headers={'Retry-After': str(retry)})
                return

            nv_key = env_vars.get('NVIDIA_API_KEY', '') or NVIDIA_API_KEY
            if nv_key:
                try:
                    req = urllib.request.Request(
                        'https://integrate.api.nvidia.com/v1/audio/transcriptions',
                        data=raw_body,
                        headers={
                            'Authorization': 'Bearer ' + nv_key,
                            'Content-Type': self.headers.get('Content-Type', 'audio/wav'),
                            'NV-Model-Name': 'parakeet-1.1b-rnnt-multilingual-asr'
                        },
                        method='POST'
                    )
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        res_data = json.loads(resp.read().decode('utf-8'))
                        txt = res_data.get('text') or res_data.get('transcript') or ''
                        if LEDGER:
                            uid = self._identify(data)
                            LEDGER.append(
                                user_id=uid, surface='stt', provider='nvidia',
                                model='parakeet-1.1b-rnnt-multilingual-asr', input_tokens=0,
                                cache_read=0, cache_write=0, output_tokens=0,
                                usd_cost=0.002, credits=0
                            )
                        self._json(200, {"transcript": txt.strip(), "model": "parakeet-1.1b-rnnt-multilingual-asr"})
                        return
                except Exception as e:
                    print(f"[stt] Error: {e}")
            self._json(200, {"transcript": "", "model": "none"})
            return

        self._json(404, {"error": "Not found", "path": path})
