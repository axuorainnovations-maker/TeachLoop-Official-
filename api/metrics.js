/**
 * Custom Vercel Observability metrics (Node.js Functions only).
 * Your main API is Python (api/index.py) — it cannot call @vercel/functions metric().
 * Use this endpoint to emit custom metrics, or call metric() from other Node functions.
 *
 * POST /api/metrics
 *   { "name": "query.duration_ms", "value": 100, "attributes": { "plan": "pro" } }
 *
 * GET /api/metrics → emits a sample datapoint (for smoke tests)
 */
import { metric } from '@vercel/functions';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function safeName(name) {
  const s = String(name || '').trim();
  if (!s || s.length >= 64) return null;
  return s.replace(/[^A-Za-z0-9._\-/]/g, '_');
}

function safeAttrs(attrs) {
  const out = {};
  if (!attrs || typeof attrs !== 'object') return out;
  for (const [k, v] of Object.entries(attrs)) {
    const key = String(k || '')
      .trim()
      .replace(/[^A-Za-z0-9._\-/]/g, '_')
      .slice(0, 63);
    const val = String(v == null ? '' : v)
      .trim()
      .replace(/[^A-Za-z0-9._\-/]/g, '_')
      .slice(0, 63);
    if (key && val) out[key] = val;
    if (Object.keys(out).length >= 50) break;
  }
  return out;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    const started = Date.now();

    if (request.method === 'GET') {
      // Example from Vercel docs — sample custom metric
      metric('query.duration_ms', 100, { plan: 'pro' });
      metric('metrics.ping_ms', Date.now() - started, { route: 'api_metrics' });
      return json({
        ok: true,
        recorded: [
          { name: 'query.duration_ms', value: 100, attributes: { plan: 'pro' } },
          { name: 'metrics.ping_ms', value: Date.now() - started, attributes: { route: 'api_metrics' } },
        ],
        note: 'View custom metrics in Vercel → Observability (after production traffic).',
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      return json({ error: 'invalid_json' }, 400);
    }

    const name = safeName(body.name || 'query.duration_ms');
    const value = Number(body.value);
    if (!name || !Number.isFinite(value)) {
      return json({ error: 'name_and_numeric_value_required' }, 400);
    }

    const attributes = safeAttrs(body.attributes || { plan: body.plan || 'free' });
    metric(name, value, attributes);
    metric('metrics.handler_ms', Date.now() - started, { route: 'api_metrics' });

    return json({ ok: true, name, value, attributes });
  },
};
