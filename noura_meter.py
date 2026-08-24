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

LEDGER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'usage_ledger.jsonl')
USERS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'usage_users.json')

# ── Pricing, USD per million tokens ──────────────────────────────────────
# Keyed by model so a model switch is a one-line change. Cache read is ~0.1x
# input and cache write ~1.25x input, per Anthropic's caching pricing.
PRICING = {
    'claude-haiku-4-5-20251001': {'in': 1.00, 'out': 5.00},
    'claude-haiku-4-5':          {'in': 1.00, 'out': 5.00},
    'claude-sonnet-5':           {'in': 3.00, 'out': 15.00},
    'claude-opus-5':             {'in': 5.00, 'out': 25.00},
}
DEFAULT_PRICING = {'in': 1.00, 'out': 5.00}
CACHE_READ_MULT = 0.10
CACHE_WRITE_MULT = 1.25

# NVIDIA speech has no token concept. Cost per unit is configurable; these are
# placeholders until real invoiced rates are known, and are marked estimated
# in the admin UI so nobody mistakes them for billed figures.
TTS_USD_PER_1K_CHARS = 0.015
STT_USD_PER_MINUTE = 0.006

# ── Credit model ─────────────────────────────────────────────────────────
# A wallet, not an allowance. Credits are GRANTED (signup gift, purchase,
# promo, manual award), they accumulate, and they are spent down.
# They never expire and they never reset.
#
#     balance = sum(grants) - sum(spends)
#
# Every user-initiated action costs a flat CREDIT_COST. Internal sub-calls
# that serve the same action are free, so one "generate a study plan" is one
# charge even though it fires several API calls underneath.
CREDIT_COST = 50          # per billable action
SIGNUP_GRANT = 500        # 10 actions to try the product before buying

# Surfaces that are internal machinery, not something the user asked for.
# Anything NOT listed here is billable. That is deliberate: a surface someone
# forgets to label gets charged and shows up in the dashboard, rather than
# silently becoming a free hole in the wallet.
FREE_SURFACES = {
    'source_card',            # prep step inside a Teach Studio session
    'teach_studio_verifier',  # hidden fact check inside a turn
    'teach_studio_student',   # individual turn; the session is charged once
    'teach_studio_report',    # end-of-session summary
    'stt',                    # speech in, part of the parent action
    'tts',                    # speech out, part of the parent action
}

# Reasons a grant can appear in the ledger. Kept as a set so the admin
# endpoint cannot invent categories that break later reporting.
GRANT_REASONS = {'signup', 'purchase', 'promo', 'referral', 'admin', 'refund'}


def credit_cost(surface):
    """Flat cost per user-initiated action; internal sub-calls are free."""
    return 0 if surface in FREE_SURFACES else CREDIT_COST


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def period_start(ts=None):
    """Calendar month boundary. One place for the reset rule."""
    d = ts or datetime.now(timezone.utc)
    return d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def period_end(ts=None):
    d = period_start(ts)
    return (d.replace(year=d.year + 1, month=1) if d.month == 12
            else d.replace(month=d.month + 1))


def token_cost(model, input_tokens, cache_read, cache_write, output_tokens):
    p = PRICING.get(model, DEFAULT_PRICING)
    return round(
        (input_tokens / 1e6) * p['in']
        + (cache_read / 1e6) * p['in'] * CACHE_READ_MULT
        + (cache_write / 1e6) * p['in'] * CACHE_WRITE_MULT
        + (output_tokens / 1e6) * p['out'],
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
        tmp = self.users_path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self._users, f, indent=2)
        os.replace(tmp, self.users_path)

    # ── users ────────────────────────────────────────────────────────────
    def ensure_user(self, user_id, email=None, tier=None):
        with self._lock:
            u = self._users.get(user_id)
            new_user = False
            if not u:
                u = {'id': user_id, 'email': None, 'tier': 'free',
                     'created': _now_iso(), 'last_seen': _now_iso(),
                     'signup_granted': False}
                self._users[user_id] = u
                new_user = True
            if email and u.get('email') != email:
                u['email'] = email
            if tier:
                u['tier'] = tier
            u['last_seen'] = _now_iso()
            self._save_users()
            snapshot = dict(u)
        # Outside the lock: grant() takes it again. The signup gift is issued
        # once per user id and recorded in the ledger like any other grant.
        if new_user and not snapshot.get('signup_granted'):
            self._mark_signup(user_id)
            self.grant(user_id, SIGNUP_GRANT, reason='signup',
                       note='Welcome credits')
        return snapshot

    def _mark_signup(self, user_id):
        with self._lock:
            u = self._users.get(user_id)
            if u:
                u['signup_granted'] = True
                self._save_users()

    def set_tier(self, user_id, tier):
        # Label only. It does not affect spending; the wallet does.
        with self._lock:
            u = self._users.get(user_id)
            if not u:
                return None
            u['tier'] = tier
            self._save_users()
            return dict(u)

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
        t = {'credits': 0, 'usd': 0.0, 'calls': 0, 'input': 0,
             'output': 0, 'cache_read': 0, 'cache_write': 0}
        for e in self._since(since):
            if e.get('user_id') != user_id or not e.get('ok', True):
                continue
            t['credits'] += e.get('credits', 0)
            t['usd'] += e.get('usd_cost', 0.0)
            t['calls'] += 1
            t['input'] += e.get('input_tokens', 0)
            t['output'] += e.get('output_tokens', 0)
            t['cache_read'] += e.get('cache_read', 0)
            t['cache_write'] += e.get('cache_write', 0)
        t['usd'] = round(t['usd'], 6)
        return t

    def org_totals(self, since=None):
        t = {'usd': 0.0, 'calls': 0, 'input': 0, 'output': 0,
             'cache_read': 0, 'cache_write': 0, 'by_model': {},
             'by_surface': {}, 'errors': 0, 'rejected': 0}
        for e in self._since(since):
            if not e.get('ok', True):
                t['errors'] += 1
                if e.get('error') == 'insufficient_credits':
                    t['rejected'] += 1
                continue
            usd = e.get('usd_cost', 0.0)
            t['usd'] += usd
            t['calls'] += 1
            t['input'] += e.get('input_tokens', 0)
            t['output'] += e.get('output_tokens', 0)
            t['cache_read'] += e.get('cache_read', 0)
            t['cache_write'] += e.get('cache_write', 0)
            m = e.get('model') or e.get('provider') or 'unknown'
            s = e.get('surface') or 'unknown'
            t['by_model'][m] = round(t['by_model'].get(m, 0.0) + usd, 6)
            t['by_surface'][s] = round(t['by_surface'].get(s, 0.0) + usd, 6)
        t['usd'] = round(t['usd'], 6)
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
                buckets[day] = round(buckets.get(day, 0.0) + e.get('usd_cost', 0.0), 6)
        return [{'date': d, 'usd': buckets[d]} for d in sorted(buckets)][-days:]

    def all_users(self, since=None):
        """Wallet balances plus lifetime spend. Credits never expire, so the
        balance is all-time; usd is what the user has actually cost us."""
        rows = []
        for uid, u in self._users.items():
            w = self.wallet(uid)
            t = self.totals_for(uid, None)
            rows.append({
                'id': uid,
                'email': u.get('email'),
                'granted': w['granted'],
                'spent': w['spent'],
                'balance': w['balance'],
                'actions': w['spent'] // CREDIT_COST if CREDIT_COST else 0,
                'usd': t['usd'],
                'calls': t['calls'],
                'created': u.get('created'),
                'last_seen': u.get('last_seen'),
                'low': w['balance'] < CREDIT_COST,
            })
        rows.sort(key=lambda r: r['usd'], reverse=True)
        return rows

    # ── wallet ───────────────────────────────────────────────────────────
    def grant(self, user_id, credits, reason='admin', by=None, note=None):
        """Award credits. Recorded as a ledger event so every grant is auditable."""
        credits = int(credits)
        if credits <= 0 or reason not in GRANT_REASONS:
            return None
        self.ensure_user(user_id)
        ev = self.append(user_id=user_id, kind='grant', surface='grant',
                         provider='none', model=None, input_tokens=0, cache_read=0,
                         cache_write=0, output_tokens=0, usd_cost=0.0,
                         credits=credits, reason=reason, granted_by=by, note=note)
        return {'granted': credits, 'balance': self.balance(user_id), 'event': ev['id']}

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
        """Granted minus spent, over all time. Credits never expire."""
        granted = spent = 0
        for e in self._events:
            if e.get('user_id') != user_id:
                continue
            if e.get('kind') == 'grant':
                granted += e.get('credits', 0)
            elif e.get('ok', True):
                spent += e.get('credits', 0)
        return granted - spent

    def wallet(self, user_id):
        granted = spent = 0
        for e in self._events:
            if e.get('user_id') != user_id:
                continue
            if e.get('kind') == 'grant':
                granted += e.get('credits', 0)
            elif e.get('ok', True):
                spent += e.get('credits', 0)
        return {'granted': granted, 'spent': spent, 'balance': granted - spent}

    # ── enforcement ──────────────────────────────────────────────────────
    def check(self, user_id, surface, enforcement='on', org_ceiling=None):
        """
        Returns (allowed, info). Callers must honour `allowed` before spending.
        `log_only` always allows but reports what it would have done.
        """
        need = credit_cost(surface)
        w = self.wallet(user_id)
        info = {'credits_needed': need, 'credits_remaining': w['balance'],
                'granted': w['granted'], 'spent': w['spent'],
                'cost_per_action': CREDIT_COST}

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
