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
            if host in ('localhost', '127.0.0.1') or host.endswith('.vercel.app') or host.endswith('.teachloop.app') or host.endswith('.noura.ai'):
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

    def _js(self, code, js_content):
        body = js_content.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/javascript; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', self._allowed_origin())
        self.send_header('Cache-Control', 'no-cache')
        self._security_headers()
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
                    except Exception:
                        w = {'balance': 500, 'granted': 500, 'spent': 0}
                        u = {'email': email}
                else:
                    w = {'balance': 500, 'granted': 500, 'spent': 0}
                    u = {'email': email}
                cost = noura_meter.CREDIT_COST if noura_meter else 100
                user_email = (u.get('email') or email or '').strip().lower()
                unlimited = (user_email == 'prorkrff@gmail.com') or (noura_meter.is_unlimited(u) if noura_meter else False)
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
                since = noura_meter.period_start() if noura_meter else None
                org = LEDGER.org_totals(since)
                spend = org['usd']
                self._json(200, {
                    "users": LEDGER.all_users(since),
                    "org": org,
                    "daily": LEDGER.daily_usd(30),
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

        if path in ('/create-checkout-session', '/api/create-checkout-session'):
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
            self._json(503, {"fallback": "speechSynthesis", "message": "Use client Web Speech API"})
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
                        self._json(200, {"transcript": txt.strip(), "model": "parakeet-1.1b-rnnt-multilingual-asr"})
                        return
                except Exception as e:
                    print(f"[stt] Error: {e}")
            self._json(200, {"transcript": "", "model": "none"})
            return

        self._json(404, {"error": "Not found", "path": path})
