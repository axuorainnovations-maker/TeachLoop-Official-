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
# One learning token = one completed AI action, weighted by how expensive the
# surface actually is. A voice teaching turn costs far more than a recall card.
CREDIT_WEIGHTS = {
    'study_assistant':       1,
    'lesson_brief':          2,
    'lesson_learn':          3,
    'lesson_check':          2,
    'lesson_recall':         1,
    'lesson_cast':           4,
    'quick_review':          2,
    'source_card':           1,
    'teach_studio_student':  2,
    'teach_studio_verifier': 1,
    'teach_studio_report':   3,
    'tts':                   1,
    'stt':                   1,
    'image':                 2,
    'unknown':               1,
}
TIER_ALLOWANCE = {
    'starter':   500,
    'scholar':   1500,
    'unlimited': None,          # no hard cap, still metered
    'beta':      1500,          # closed-beta default
}
FAIR_USE_FLAG = 6000            # unlimited users above this get an admin flag


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
            if not u:
                u = {'id': user_id, 'email': None, 'tier': 'beta',
                     'created': _now_iso(), 'last_seen': _now_iso()}
                self._users[user_id] = u
            if email and u.get('email') != email:
                u['email'] = email
            if tier and tier in TIER_ALLOWANCE:
                u['tier'] = tier
            u['last_seen'] = _now_iso()
            self._save_users()
            return dict(u)

    def set_tier(self, user_id, tier):
        if tier not in TIER_ALLOWANCE:
            return None
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
        since = since or period_start()
        rows = []
        for uid, u in self._users.items():
            t = self.totals_for(uid, since)
            tier = u.get('tier', 'beta')
            allowance = TIER_ALLOWANCE.get(tier)
            rows.append({
                'id': uid,
                'email': u.get('email'),
                'tier': tier,
                'allowance': allowance,
                'credits_used': t['credits'],
                'credits_left': (None if allowance is None
                                 else max(0, allowance - t['credits'])),
                'usd': t['usd'],
                'calls': t['calls'],
                'last_seen': u.get('last_seen'),
                'over_fair_use': allowance is None and t['credits'] > FAIR_USE_FLAG,
            })
        rows.sort(key=lambda r: r['usd'], reverse=True)
        return rows

    # ── enforcement ──────────────────────────────────────────────────────
    def check(self, user_id, surface, enforcement='on', org_ceiling=None):
        """
        Returns (allowed, info). Callers must honour `allowed` before spending.
        `log_only` always allows but reports what it would have done.
        """
        need = CREDIT_WEIGHTS.get(surface, CREDIT_WEIGHTS['unknown'])
        u = self._users.get(user_id) or {}
        tier = u.get('tier', 'beta')
        allowance = TIER_ALLOWANCE.get(tier)
        used = self.totals_for(user_id, period_start())['credits']
        left = None if allowance is None else max(0, allowance - used)

        info = {'credits_needed': need, 'credits_remaining': left, 'tier': tier,
                'resets_at': period_end().isoformat(timespec='seconds').replace('+00:00', 'Z')}

        # Org-level circuit breaker outranks the per-user check.
        if org_ceiling:
            spend = self.org_totals(period_start())['usd']
            if spend >= org_ceiling:
                info['error'] = 'service_capacity'
                info['would_block'] = True
                return (enforcement != 'on'), info

        if allowance is not None and left is not None and left < need:
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
