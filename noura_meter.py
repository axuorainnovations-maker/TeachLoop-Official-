"""
Noura usage metering and credit accounting.

Append-only ledger of every provider call, plus the credit rules built on top of
it. Kept separate from serve.py so the storage layer can be swapped for Supabase
or Postgres later without touching call sites.

Nothing here ever touches an API key. The ledger records what a call cost, not
how it was authorised.
"""

import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone

if os.environ.get('VERCEL') or os.environ.get('AWS_LAMBDA_FUNCTION_NAME') or not os.access(os.path.dirname(os.path.abspath(__file__)), os.W_OK):
    LEDGER_PATH = os.path.join('/tmp', 'usage_ledger.jsonl')
    USERS_PATH = os.path.join('/tmp', 'usage_users.json')
else:
    LEDGER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'usage_ledger.jsonl')
    USERS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'usage_users.json')

# ── Pricing, USD per million tokens or per unit ─────────────────────────
# Keyed by model so a model switch is a one-line change. Cache read is ~0.1x
# input and cache write ~1.25x input, per Anthropic's caching pricing.
PRICING = {
    # Anthropic Claude Models ($ / M tokens)
    'claude-haiku-4-5-20251001': {'in': 1.00, 'out': 5.00},
    'claude-haiku-4-5':          {'in': 1.00, 'out': 5.00},
    'claude-sonnet-4-5-20250929': {'in': 3.00, 'out': 15.00},
    'claude-sonnet-5':           {'in': 3.00, 'out': 15.00},
    'claude-opus-4-5-20251101':   {'in': 5.00, 'out': 25.00},
    'claude-opus-5':             {'in': 5.00, 'out': 25.00},
    # NVIDIA NIM LLM / Vision Models ($ / M tokens)
    'meta/llama-3.2-11b-vision-instruct': {'in': 0.15, 'out': 0.15},
    'nvidia/nemotron-3.5-lightning-30b-a3b': {'in': 0.20, 'out': 0.20},
    'meta/llama-3.2-90b-vision-instruct': {'in': 0.70, 'out': 0.70},
    'deepseek-ai/deepseek-v4-flash-0731': {'in': 0.14, 'out': 0.28},
    'meta/llama-3.1-8b-instruct':         {'in': 0.15, 'out': 0.15},
    'meta/llama-3.3-70b-instruct':        {'in': 0.70, 'out': 0.80},
    # NVIDIA GenAI / Speech ($ per unit)
    'black-forest-labs/flux-1-dev':       {'unit': 0.025},
    'flux-1-dev':                         {'unit': 0.025},
    'parakeet-1.1b-rnnt-multilingual-asr': {'unit': 0.002},
}
DEFAULT_PRICING = {'in': 1.00, 'out': 5.00}
CACHE_READ_MULT = 0.10
CACHE_WRITE_MULT = 1.25

# NVIDIA speech rates
TTS_USD_PER_1K_CHARS = 0.015
STT_USD_PER_MINUTE = 0.006

# ── Credit model ─────────────────────────────────────────────────────────
# A wallet, with a daily refresh policy.
# Every user gets 500 credits refreshed daily (so if a user spends 50 credits,
# leaving 450, it refreshes back to 500, not 950).
CREDIT_COST = 100         # per lesson / billable action (Study Brief, Learn, Checkpoint, Recall, Audio Recap)
SIGNUP_GRANT = 500        # 5 full study packages to try before buying
PRO_ALLOWANCE = 5000     # Pro plan allowance (50 lessons / actions)
FREE_ALLOWANCE = 500     # Free plan allowance (5 lessons / actions)
DAILY_ALLOWANCE = 500    # Default daily reset target balance

# Surfaces that are internal machinery, not something the user asked for.
FREE_SURFACES = {
    'source_card',            # prep step inside a Teach Studio session
    'teach_studio_verifier',  # hidden fact check inside a turn
    'teach_studio_student',   # individual turn; the session is charged once
    'teach_studio_report',    # end-of-session summary
    'stt',                    # speech in, part of the parent action
    'tts',                    # speech out, part of the parent action
}

# Reasons a grant can appear in the ledger.
GRANT_REASONS = {'signup', 'purchase', 'promo', 'referral', 'admin', 'refund', 'daily_reset'}

# Accounts that bypass the wallet entirely: founders, demo accounts, support.
UNLIMITED_EMAILS = {
    'prorkrff@gmail.com',
}


def is_unlimited(user):
    if not user:
        return False
    email = (user.get('email') or '').strip().lower()
    tier = (user.get('tier') or '').strip().lower()
    return (email in UNLIMITED_EMAILS) or (tier == 'unlimited')


def tier_allowance(tier):
    t = str(tier or 'free').lower().strip()
    if t == 'pro':
        return PRO_ALLOWANCE
    return FREE_ALLOWANCE


def credit_cost(surface):
    """Flat cost per user-initiated action; internal sub-calls are free."""
    return 0 if surface in FREE_SURFACES else CREDIT_COST


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def _today_utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def period_start(ts=None):
    """Calendar month boundary. One place for the reset rule."""
    d = ts or datetime.now(timezone.utc)
    return d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def period_end(ts=None):
    d = period_start(ts)
    return (d.replace(year=d.year + 1, month=1) if d.month == 12
            else d.replace(month=d.month + 1))


def token_cost(model, input_tokens, cache_read, cache_write, output_tokens):
    p = PRICING.get(model)
    if not p:
        m_lower = (model or '').lower()
        if 'flux' in m_lower:
            return 0.025
        if 'parakeet' in m_lower or 'asr' in m_lower:
            return 0.002
        if 'deepseek' in m_lower:
            p = {'in': 0.14, 'out': 0.28}
        elif 'llama' in m_lower or 'nemotron' in m_lower:
            p = {'in': 0.20, 'out': 0.20}
        elif 'opus' in m_lower:
            p = {'in': 5.00, 'out': 25.00}
        elif 'sonnet' in m_lower:
            p = {'in': 3.00, 'out': 15.00}
        elif 'haiku' in m_lower:
            p = {'in': 1.00, 'out': 5.00}
        else:
            p = DEFAULT_PRICING
    
    if 'unit' in p:
        return float(p['unit'])

    return round(
        (input_tokens / 1e6) * p.get('in', 1.0)
        + (cache_read / 1e6) * p.get('in', 1.0) * CACHE_READ_MULT
        + (cache_write / 1e6) * p.get('in', 1.0) * CACHE_WRITE_MULT
        + (output_tokens / 1e6) * p.get('out', 5.0),
        8,
    )


class Ledger:
    """Append-only event log. Reads are served from an in-memory index."""

    def __init__(self, path=LEDGER_PATH, users_path=USERS_PATH):
        self.path = path
        self.users_path = users_path
        self._lock = threading.Lock()          # the server is threaded
        self._events = []
        self._users = {}
        self._load()

    # ── persistence ──────────────────────────────────────────────────────
    def _load(self):
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            self._events.append(json.loads(line))
                        except Exception:
                            pass                # skip a torn line, keep the rest
        except FileNotFoundError:
            pass
        try:
            with open(self.users_path, 'r', encoding='utf-8') as f:
                self._users = json.load(f)
        except Exception:
            self._users = {}

    def _save_users(self):
        try:
            tmp = self.users_path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self._users, f, indent=2)
            os.replace(tmp, self.users_path)
        except Exception as e:
            pass

    # ── users ────────────────────────────────────────────────────────────
    def find_user_by_email(self, email):
        if not email:
            return None
        target = str(email).strip().lower()
        with self._lock:
            for uid, u in self._users.items():
                if (u.get('email') or '').strip().lower() == target:
                    return uid
                if uid.lower() == target:
                    return uid
        return None

    def ensure_user(self, user_id, email=None, tier=None):
        today_str = _today_utc()
        with self._lock:
            u = self._users.get(user_id)
            new_user = False
            if not u:
                u = {'id': user_id, 'email': None, 'tier': 'free',
                     'created': _now_iso(), 'last_seen': _now_iso(),
                     'signup_granted': False, 'last_daily_refresh': today_str}
                self._users[user_id] = u
                new_user = True
            if email and u.get('email') != email:
                u['email'] = str(email).strip().lower()
            if tier:
                u['tier'] = str(tier).strip().lower()
            u['last_seen'] = _now_iso()
            self._save_users()
            snapshot = dict(u)
        # Outside the lock: grant() takes it again.
        if new_user and not snapshot.get('signup_granted'):
            self._mark_signup(user_id)
            self.grant(user_id, SIGNUP_GRANT, reason='signup',
                       note='Welcome credits')
        else:
            self._check_daily_refresh(user_id)
        return snapshot

    def _mark_signup(self, user_id):
        with self._lock:
            u = self._users.get(user_id)
            if u:
                u['signup_granted'] = True
                u['last_daily_refresh'] = _today_utc()
                self._save_users()

    def _check_daily_refresh(self, user_id):
        """
        Guarantees that each user gets credits refreshed daily (UTC) based on tier:
        - Free plan: refreshes to 500 credits.
        - Pro plan: refreshes to 5,000 credits.
        - Unlimited plan: bypassed.
        If user spent 50 credits and has 450 left (Free), it tops up by 50 to reach 500 (not 950).
        If user has >= target allowance, no top-up needed.
        """
        today_str = _today_utc()
        with self._lock:
            u = self._users.get(user_id)
            if not u:
                return
            if is_unlimited(u):
                return
            tier = (u.get('tier') or 'free').lower().strip()
            last_refresh = u.get('last_daily_refresh')
            if last_refresh == today_str:
                return
            u['last_daily_refresh'] = today_str
            self._save_users()

        target_allowance = tier_allowance(tier)
        granted = spent = 0
        for e in self._events:
            if e.get('user_id') != user_id:
                continue
            if e.get('kind') == 'grant':
                granted += e.get('credits', 0)
            elif e.get('ok', True):
                spent += e.get('credits', 0)

        current_bal = max(0, granted - spent)
        if current_bal < target_allowance:
            top_up = target_allowance - current_bal
            self.grant(user_id, top_up, reason='daily_reset', by='system',
                       note=f'Daily {target_allowance} credits refresh ({today_str})')

    def set_tier(self, user_id, tier):
        user_id = self._resolve_uid(user_id)
        tier_clean = str(tier).lower().strip()
        if tier_clean not in ('free', 'pro', 'unlimited'):
            tier_clean = 'free'
        with self._lock:
            u = self._users.get(user_id)
            if not u:
                u = {'id': user_id, 'email': None, 'tier': tier_clean,
                     'created': _now_iso(), 'last_seen': _now_iso(),
                     'signup_granted': False, 'last_daily_refresh': _today_utc()}
                self._users[user_id] = u
            u['tier'] = tier_clean
            self._save_users()

        # If upgraded to Pro and balance < 5000, award credits to reach 5,000
        if tier_clean == 'pro':
            w = self.wallet(user_id)
            if w['balance'] < PRO_ALLOWANCE:
                top_up = PRO_ALLOWANCE - w['balance']
                self.grant(user_id, top_up, reason='promo', by='admin',
                           note='Pro Plan activation (5,000 credits)')
        return dict(self._users.get(user_id) or {})

    def user(self, user_id):
        return dict(self._users.get(user_id) or {})

    # ── writing ──────────────────────────────────────────────────────────
    def append(self, **ev):
        ev.setdefault('id', 'evt_' + secrets.token_hex(8))
        ev.setdefault('ts', _now_iso())
        ev.setdefault('ok', True)
        ev.setdefault('error', None)
        with self._lock:
            self._events.append(ev)
            try:
                with open(self.path, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(ev) + '\n')
            except Exception as e:
                print('[meter] ledger write failed:', e)
        return ev

    # ── reading ──────────────────────────────────────────────────────────
    def _since(self, since):
        if since is None:
            return self._events
        cutoff = since.isoformat(timespec='seconds').replace('+00:00', 'Z')
        return [e for e in self._events if e.get('ts', '') >= cutoff]

    def totals_for(self, user_id, since=None):
        t = {
            'credits': 0, 'usd': 0.0, 'calls': 0, 'input': 0,
            'output': 0, 'cache_read': 0, 'cache_write': 0,
            'anthropic_usd': 0.0, 'anthropic_calls': 0, 'anthropic_tokens': 0,
            'nvidia_usd': 0.0, 'nvidia_calls': 0, 'nvidia_tokens': 0,
        }
        for e in self._since(since):
            if e.get('user_id') != user_id or not e.get('ok', True):
                continue
            usd = float(e.get('usd_cost', 0.0) or 0.0)
            inp = int(e.get('input_tokens', 0) or 0)
            out = int(e.get('output_tokens', 0) or 0)
            c_read = int(e.get('cache_read', 0) or 0)
            c_write = int(e.get('cache_write', 0) or 0)
            kind = str(e.get('kind') or '').lower().strip()
            surface = str(e.get('surface') or '').lower().strip()
            provider = str(e.get('provider') or '').lower().strip()
            model = str(e.get('model') or '').lower().strip()

            t['credits'] += int(e.get('credits', 0) or 0)
            t['usd'] += usd

            # Do not count credit grant events as API calls
            if kind == 'grant' or surface in ('grant', 'admin_adjustment') or provider in ('none', 'admin'):
                continue

            t['calls'] += 1
            t['input'] += inp
            t['output'] += out
            t['cache_read'] += c_read
            t['cache_write'] += c_write

            if provider == 'anthropic' or 'claude' in model:
                t['anthropic_usd'] += usd
                t['anthropic_calls'] += 1
                t['anthropic_tokens'] += (inp + out)
            elif (provider == 'nvidia' or 'nvidia' in model or 'llama' in model
                  or 'flux' in model or 'parakeet' in model or 'nemotron' in model
                  or 'deepseek' in model or 'chatterbox' in model or surface in ('stt', 'tts', 'diagram')):
                t['nvidia_usd'] += usd
                t['nvidia_calls'] += 1
                t['nvidia_tokens'] += (inp + out)
            else:
                if 'anthropic' in provider:
                    t['anthropic_usd'] += usd
                    t['anthropic_calls'] += 1
                    t['anthropic_tokens'] += (inp + out)
                elif 'nvidia' in provider:
                    t['nvidia_usd'] += usd
                    t['nvidia_calls'] += 1
                    t['nvidia_tokens'] += (inp + out)

        t['usd'] = round(t['usd'], 6)
        t['anthropic_usd'] = round(t['anthropic_usd'], 6)
        t['nvidia_usd'] = round(t['nvidia_usd'], 6)
        return t

    def org_totals(self, since=None):
        t = {
            'usd': 0.0, 'calls': 0, 'input': 0, 'output': 0,
            'cache_read': 0, 'cache_write': 0, 'by_model': {},
            'by_surface': {}, 'by_provider': {'anthropic': 0.0, 'nvidia': 0.0},
            'anthropic_usd': 0.0, 'anthropic_calls': 0, 'anthropic_tokens': 0,
            'nvidia_usd': 0.0, 'nvidia_calls': 0, 'nvidia_tokens': 0,
            'errors': 0, 'rejected': 0
        }
        for e in self._since(since):
            if not e.get('ok', True):
                t['errors'] += 1
                if e.get('error') == 'insufficient_credits':
                    t['rejected'] += 1
                continue
            usd = float(e.get('usd_cost', 0.0) or 0.0)
            inp = int(e.get('input_tokens', 0) or 0)
            out = int(e.get('output_tokens', 0) or 0)
            c_read = int(e.get('cache_read', 0) or 0)
            c_write = int(e.get('cache_write', 0) or 0)
            kind = str(e.get('kind') or '').lower().strip()
            surface = str(e.get('surface') or '').lower().strip()
            provider = str(e.get('provider') or '').lower().strip()
            model = str(e.get('model') or '').lower().strip()

            t['usd'] += usd

            if kind == 'grant' or surface in ('grant', 'admin_adjustment') or provider in ('none', 'admin'):
                continue

            t['calls'] += 1
            t['input'] += inp
            t['output'] += out
            t['cache_read'] += c_read
            t['cache_write'] += c_write
            m = e.get('model') or e.get('provider') or 'unknown'
            s = e.get('surface') or 'unknown'
            t['by_model'][m] = round(t['by_model'].get(m, 0.0) + usd, 6)
            t['by_surface'][s] = round(t['by_surface'].get(s, 0.0) + usd, 6)

            if provider == 'anthropic' or 'claude' in model:
                t['anthropic_usd'] += usd
                t['anthropic_calls'] += 1
                t['anthropic_tokens'] += (inp + out)
                t['by_provider']['anthropic'] = round(t['by_provider']['anthropic'] + usd, 6)
            elif (provider == 'nvidia' or 'nvidia' in model or 'llama' in model
                  or 'flux' in model or 'parakeet' in model or 'nemotron' in model
                  or 'deepseek' in model or 'chatterbox' in model or surface in ('stt', 'tts', 'diagram')):
                t['nvidia_usd'] += usd
                t['nvidia_calls'] += 1
                t['nvidia_tokens'] += (inp + out)
                t['by_provider']['nvidia'] = round(t['by_provider']['nvidia'] + usd, 6)
            else:
                if 'anthropic' in provider:
                    t['anthropic_usd'] += usd
                    t['anthropic_calls'] += 1
                    t['anthropic_tokens'] += (inp + out)
                    t['by_provider']['anthropic'] = round(t['by_provider']['anthropic'] + usd, 6)
                elif 'nvidia' in provider:
                    t['nvidia_usd'] += usd
                    t['nvidia_calls'] += 1
                    t['nvidia_tokens'] += (inp + out)
                    t['by_provider']['nvidia'] = round(t['by_provider']['nvidia'] + usd, 6)

        t['usd'] = round(t['usd'], 6)
        t['anthropic_usd'] = round(t['anthropic_usd'], 6)
        t['nvidia_usd'] = round(t['nvidia_usd'], 6)
        reads = t['cache_read']
        billed_in = t['input'] + reads
        t['cache_hit_rate'] = round(reads / billed_in, 4) if billed_in else 0.0
        return t

    def daily_usd(self, days=30):
        """[{date, usd}] oldest first, for the sparkline."""
        buckets = {}
        for e in self._events:
            if not e.get('ok', True):
                continue
            day = (e.get('ts') or '')[:10]
            if day:
                buckets[day] = round(buckets.get(day, 0.0) + float(e.get('usd_cost', 0.0) or 0.0), 6)
        return [{'date': d, 'usd': buckets[d]} for d in sorted(buckets)][-days:]

    def all_users(self, since=None):
        """Wallet balances plus lifetime spend broken down by Anthropic and NVIDIA."""
        rows = []
        for uid, u in self._users.items():
            w = self.wallet(uid)
            t = self.totals_for(uid, None)
            tier = (u.get('tier') or 'free').lower().strip()
            unlimited = is_unlimited(u)
            # 1 credit = ~50 tokens capacity
            tokens_left = 999999999 if unlimited else (w['balance'] * 50)
            rows.append({
                'id': uid,
                'email': u.get('email'),
                'tier': tier,
                'granted': w['granted'],
                'spent': w['spent'],
                'balance': w['balance'],
                'actions': 999999 if unlimited else (w['balance'] // CREDIT_COST if CREDIT_COST else 0),
                'tokens_left': tokens_left,
                'usd': t['usd'],
                'anthropic_usd': t['anthropic_usd'],
                'nvidia_usd': t['nvidia_usd'],
                'anthropic_calls': t['anthropic_calls'],
                'nvidia_calls': t['nvidia_calls'],
                'calls': t['calls'],
                'created': u.get('created'),
                'last_seen': u.get('last_seen'),
                'low': w['balance'] < CREDIT_COST and not unlimited,
                'unlimited': unlimited,
            })
        rows.sort(key=lambda r: r['usd'], reverse=True)
        return rows

    # ── wallet ───────────────────────────────────────────────────────────
    def _resolve_uid(self, user_id_or_email):
        if not user_id_or_email:
            return None
        s = str(user_id_or_email).strip()
        with self._lock:
            if s in self._users:
                return s
        existing = self.find_user_by_email(s)
        if existing:
            return existing
        if '@' in s:
            uid = 'usr_' + secrets.token_hex(8)
            self.ensure_user(uid, email=s.lower())
            return uid
        return s

    def grant(self, user_id, credits, reason='admin', by=None, note=None):
        """Award credits. Recorded as a ledger event so every grant is auditable."""
        credits = int(credits)
        if credits <= 0 or reason not in GRANT_REASONS:
            return None
        user_id = self._resolve_uid(user_id)
        with self._lock:
            if user_id not in self._users:
                self._users[user_id] = {
                    'id': user_id, 'email': None, 'tier': 'free',
                    'created': _now_iso(), 'last_seen': _now_iso(),
                    'signup_granted': True, 'last_daily_refresh': _today_utc()
                }
                self._save_users()
        ev = self.append(user_id=user_id, kind='grant', surface='grant',
                         provider='none', model=None, input_tokens=0, cache_read=0,
                         cache_write=0, output_tokens=0, usd_cost=0.0,
                         credits=credits, reason=reason, granted_by=by, note=note)
        return {'granted': credits, 'balance': self.balance(user_id), 'event': ev['id'], 'user_id': user_id}

    def deduct(self, user_id, credits, reason='admin_deduct', by=None, note=None):
        """Remove/deduct credits. Recorded as a ledger spend event."""
        credits = int(credits)
        if credits <= 0:
            return None
        user_id = self._resolve_uid(user_id)
        with self._lock:
            if user_id not in self._users:
                self._users[user_id] = {
                    'id': user_id, 'email': None, 'tier': 'free',
                    'created': _now_iso(), 'last_seen': _now_iso(),
                    'signup_granted': True, 'last_daily_refresh': _today_utc()
                }
                self._save_users()
        ev = self.append(user_id=user_id, kind='spend', surface='admin_adjustment',
                         provider='admin', model=None, input_tokens=0, cache_read=0,
                         cache_write=0, output_tokens=0, usd_cost=0.0,
                         credits=credits, reason=reason, granted_by=by, note=note)
        return {'deducted': credits, 'balance': self.balance(user_id), 'event': ev['id'], 'user_id': user_id}

    def claim_welcome(self, user_id):
        """Ensure the signup grant exists and report whether this is the first
        time it has been surfaced. Returns True once per user, never again."""
        self.ensure_user(user_id)      # issues the grant if it is missing
        with self._lock:
            u = self._users.get(user_id) or {}
            if u.get('welcome_ack'):
                return False
            u['welcome_ack'] = True
            self._save_users()
            return True

    def balance(self, user_id):
        """Granted minus spent, over all time."""
        return self.wallet(user_id)['balance']

    def wallet(self, user_id):
        self._check_daily_refresh(user_id)
        granted = spent = 0
        for e in self._events:
            if e.get('user_id') != user_id:
                continue
            if e.get('kind') == 'grant':
                granted += e.get('credits', 0)
            elif e.get('ok', True):
                spent += e.get('credits', 0)
        if granted == 0:
            granted = SIGNUP_GRANT
        return {'granted': granted, 'spent': spent, 'balance': max(0, granted - spent)}

    # ── enforcement ──────────────────────────────────────────────────────
    def check(self, user_id, surface, enforcement='on', org_ceiling=None):
        """
        Returns (allowed, info). Callers must honour `allowed` before spending.
        `log_only` always allows but reports what it would have done.
        """
        need = credit_cost(surface)
        w = self.wallet(user_id)
        u = self._users.get(user_id) or {}
        unlimited = is_unlimited(u)
        info = {'credits_needed': need, 'credits_remaining': w['balance'],
                'granted': w['granted'], 'spent': w['spent'],
                'cost_per_action': CREDIT_COST, 'unlimited': unlimited}
        if unlimited:
            info['would_block'] = False
            return True, info

        # Org circuit breaker outranks the wallet: if we are out of budget,
        # nobody spends, regardless of what they hold.
        if org_ceiling:
            spend = self.org_totals(period_start())['usd']
            if spend >= org_ceiling:
                info['error'] = 'service_capacity'
                info['would_block'] = True
                return (enforcement != 'on'), info

        if need > 0 and w['balance'] < need:
            info['error'] = 'insufficient_credits'
            info['would_block'] = True
            return (enforcement != 'on'), info

        info['would_block'] = False
        return True, info


# ── identity ─────────────────────────────────────────────────────────────
_UID_RE = re.compile(r'^usr_[0-9a-f]{16}$')


def new_user_id():
    return 'usr_' + secrets.token_hex(8)


def parse_cookie_uid(cookie_header):
    """Read our own cookie. Anything malformed is treated as absent."""
    if not cookie_header:
        return None
    for part in cookie_header.split(';'):
        if '=' not in part:
            continue
        k, v = part.strip().split('=', 1)
        if k == 'noura_uid' and _UID_RE.match(v.strip()):
            return v.strip()
    return None


# ── SSE usage extraction ─────────────────────────────────────────────────
class StreamUsage:
    """
    Accumulates token usage from an Anthropic SSE stream while the bytes are
    being passed through to the browser. message_start carries input and cache
    counts; message_delta carries the running output count.
    """

    def __init__(self):
        self.buf = b''
        self.input_tokens = 0
        self.cache_read = 0
        self.cache_write = 0
        self.output_tokens = 0
        self.model = None

    def feed(self, chunk):
        self.buf += chunk
        while b'\n' in self.buf:
            line, self.buf = self.buf.split(b'\n', 1)
            line = line.strip()
            if not line.startswith(b'data:'):
                continue
            try:
                obj = json.loads(line[5:].strip().decode('utf-8'))
            except Exception:
                continue
            t = obj.get('type')
            if t == 'message_start':
                msg = obj.get('message') or {}
                self.model = msg.get('model') or self.model
                u = msg.get('usage') or {}
                self.input_tokens = u.get('input_tokens', 0) or 0
                self.cache_read = u.get('cache_read_input_tokens', 0) or 0
                self.cache_write = u.get('cache_creation_input_tokens', 0) or 0
                self.output_tokens = u.get('output_tokens', 0) or 0
            elif t == 'message_delta':
                u = obj.get('usage') or {}
                if 'output_tokens' in u:
                    self.output_tokens = u.get('output_tokens') or 0


LEDGER = Ledger()
