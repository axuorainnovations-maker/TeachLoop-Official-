import os
import sys
import json
import struct
import urllib.request
import urllib.error
import urllib.parse
import secrets
import time
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
ADMIN_TOKEN = env_vars.get('NOURA_ADMIN_TOKEN', '') or 'noura123'

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


class handler(BaseHTTPRequestHandler):
    def _json(self, code, payload, headers=None):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Noura-Admin, X-Noura-Surface, X-Noura-Email, X-Sample-Rate, X-Language')
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
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Noura-Admin, X-Noura-Surface, X-Noura-Email, X-Sample-Rate, X-Language')
        self.end_headers()

    def do_OPTIONS(self):
        self._cors()

    def _identify(self, body_dict=None):
        email = (self.headers.get('X-Noura-Email') or '').strip()
        if not email and body_dict and isinstance(body_dict, dict):
            email = (body_dict.get('email') or '').strip()
        
        cookie_uid = None
        if noura_meter:
            cookie_uid = noura_meter.parse_cookie_uid(self.headers.get('Cookie'))
        
        if email and '@' in email and LEDGER:
            return LEDGER.claim_email(email, cookie_uid=cookie_uid)
        if cookie_uid:
            return cookie_uid
        if noura_meter:
            return noura_meter.new_user_id()
        return 'usr_' + secrets.token_hex(6)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Strip .html / normalize
        if path == '/config.js':
            self._js(200, f'const ENV = {json.dumps(public_env)};\n')
            return

        if path == '/supabase-config.js':
            self._js(200, f'window.SUPABASE_URL = "{sb_url}";\nwindow.SUPABASE_ANON_KEY = "{sb_anon}";\n')
            return

        if path in ('/api/me', '/api/credits'):
            uid = self._identify()
            w = LEDGER.wallet(uid) if LEDGER else {'balance': 500, 'unlimited': False, 'total_granted': 500, 'total_spent': 0}
            u = LEDGER.user(uid) if LEDGER else {}
            cost = noura_meter.CREDIT_COST if noura_meter else 50
            unlimited = noura_meter.is_unlimited(u) if (noura_meter and u) else False
            bal = w.get('balance', 500)
            
            self._json(200, {
                "user_id": uid,
                "email": u.get('email') or None,
                "tier": u.get('tier', 'free'),
                "balance": bal,
                "unlimited": unlimited,
                "actions_left": 999999 if unlimited else (bal // cost if cost else 0),
                "cost_per_action": cost,
                "total_granted": w.get('total_granted', 500),
                "total_spent": w.get('total_spent', 0),
            })
            return

        if path == '/api/ping':
            self._json(200, {"status": "ok", "app": "Noura", "time": int(time.time())})
            return

        self._json(404, {"error": "Not found", "path": path})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get('Content-Length', 0))
        raw_body = self.rfile.read(length) if length > 0 else b'{}'
        
        try:
            data = json.loads(raw_body.decode('utf-8')) if raw_body else {}
        except Exception:
            try:
                data = {k: v[0] for k, v in urllib.parse.parse_qs(raw_body.decode('utf-8')).items()}
            except Exception:
                data = {}

        if path == '/create-checkout-session':
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
                self._json(400, {'error': {'message': str(e)}})
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
                self._json(400, {'error': {'message': str(e)}})
            return

        elif path == '/webhook':
            sig_header = self.headers.get('Stripe-Signature')
            webhook_secret = env_vars.get('STRIPE_WEBHOOK_SECRET', '')
            try:
                if stripe and webhook_secret and sig_header:
                    event = stripe.Webhook.construct_event(raw_body, sig_header, webhook_secret)
                else:
                    event = json.loads(raw_body.decode('utf-8') or '{}')
                print(f"[Stripe Webhook] Event: {event.get('type') if isinstance(event, dict) else getattr(event, 'type', '')}")
                self._json(200, {'status': 'success'})
            except Exception as e:
                self._json(400, {'error': f'Webhook verification failed: {str(e)}'})
            return

        elif path == '/api/welcome':
            uid = self._identify(data)
            first = LEDGER.claim_welcome(uid) if LEDGER else True
            w = LEDGER.wallet(uid) if LEDGER else {'balance': 500}
            cost = noura_meter.CREDIT_COST if noura_meter else 50
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

        elif path in ('/v1/messages', '/api/messages'):
            anthropic_key = env_vars.get('ANTHROPIC_API_KEY', '') or ANTHROPIC_API_KEY
            nv_key = env_vars.get('NVIDIA_API_KEY', '') or NVIDIA_API_KEY

            # Model normalization
            model_req = str(data.get('model') or '')
            if 'haiku' in model_req.lower():
                data['model'] = 'claude-haiku-4-5-20251001'
            elif 'sonnet' in model_req.lower():
                data['model'] = 'claude-sonnet-4-5-20250929'
            elif 'opus' in model_req.lower():
                data['model'] = 'claude-opus-4-5-20251101'
            elif not model_req:
                data['model'] = 'claude-haiku-4-5-20251001'

            # Try Anthropic Claude
            if anthropic_key:
                try:
                    if 'system' in data and data['system']:
                        if isinstance(data['system'], str):
                            data['system'] = [{"type": "text", "text": data['system'], "cache_control": {"type": "ephemeral"}}]
                        elif isinstance(data['system'], list) and len(data['system']) > 0:
                            if "cache_control" not in data['system'][-1]:
                                data['system'][-1]["cache_control"] = {"type": "ephemeral"}

                    req_data = json.dumps(data).encode('utf-8')
                    anth_req = urllib.request.Request(
                        'https://api.anthropic.com/v1/messages',
                        data=req_data,
                        headers={
                            'x-api-key': anthropic_key,
                            'anthropic-version': '2023-06-01',
                            'anthropic-beta': 'prompt-caching-2024-07-31',
                            'Content-Type': 'application/json',
                        }
                    )
                    with urllib.request.urlopen(anth_req, timeout=60) as resp:
                        resp_bytes = resp.read()
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(resp_bytes)
                        return
                except Exception as e:
                    print(f"[chat] Anthropic error, trying NVIDIA fallback: {e}")

            # Fallback to NVIDIA NIM
            if nv_key:
                try:
                    sys_prompt = data.get("system", "")
                    msgs = data.get("messages", [])
                    formatted_msgs = []
                    if sys_prompt:
                        if isinstance(sys_prompt, list):
                            sys_str = "\n\n".join([x.get('text', '') if isinstance(x, dict) else str(x) for x in sys_prompt])
                        else:
                            sys_str = str(sys_prompt)
                        formatted_msgs.append({"role": "system", "content": sys_str})
                    for m in msgs:
                        content = m.get("content", "")
                        content_str = content if isinstance(content, str) else "\n\n".join([c.get("text", "") for c in content if isinstance(c, dict)])
                        formatted_msgs.append({"role": m.get("role", "user"), "content": content_str})

                    candidate_models = [
                        'meta/llama-3.2-11b-vision-instruct',
                        'nvidia/nemotron-3.5-lightning-30b-a3b',
                        'meta/llama-3.2-90b-vision-instruct'
                    ]
                    for chosen_model in candidate_models:
                        req_body = json.dumps({
                            "model": chosen_model,
                            "messages": formatted_msgs,
                            "max_tokens": min(data.get("max_tokens", 800) or 800, 8000)
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
                            with urllib.request.urlopen(req, timeout=30) as resp:
                                resp_data = json.loads(resp.read().decode('utf-8'))
                                reply = resp_data.get('choices', [{}])[0].get('message', {}).get('content', '')
                                self._json(200, {
                                    "reply": reply,
                                    "content": [{"type": "text", "text": reply}]
                                })
                                return
                        except Exception:
                            continue
                except Exception as e:
                    self._json(500, {"error": {"message": f"NVIDIA NIM Chat Error: {e}"}})
                    return

            self._json(500, {"error": {"message": "No valid LLM API key available (configure ANTHROPIC_API_KEY or NVIDIA_API_KEY in Vercel settings)."}})
            return

        elif path == '/api/generate-image':
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

        self._json(404, {"error": "Not found", "path": path})
