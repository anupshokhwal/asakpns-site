// ASAKPNS website Worker.
// Serves the static site from ./public and handles the contact form at
// POST /api/contact: checks Cloudflare Turnstile, then emails the enquiry
// to hello@ through Migadu. Nothing is stored.
import { buildMessage, sendMail } from './smtp.js';

const LIMITS = { name: 100, email: 254, company: 120, timeline: 100, country: 100, message: 5000 };
const EXPECTED_ACTION = 'contact';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// One line, no control characters (prevents header injection), trimmed and capped.
function cleanLine(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, max);
}

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

// Returns { ok, reason }. The reason is a short, non-secret code shown to the
// visitor and logged, so a failed check can be diagnosed.
async function verifyTurnstile(env, token, ip) {
  const allowed = new Set(String(env.TURNSTILE_HOSTNAMES ?? '').split(',').map((h) => h.trim()).filter(Boolean));
  if (!env.TURNSTILE_SECRET) return { ok: false, reason: 'server-secret-missing' };
  if (allowed.size === 0) return { ok: false, reason: 'server-hostnames-missing' };
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return { ok: false, reason: 'no-token' };
  let result;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret: String(env.TURNSTILE_SECRET).trim(), response: token, remoteip: ip ?? '' }),
    });
    if (!r.ok) return { ok: false, reason: `siteverify-http-${r.status}` };
    result = await r.json();
  } catch {
    return { ok: false, reason: 'siteverify-unreachable' }; // fail closed
  }
  if (result.success !== true) {
    const codes = Array.isArray(result['error-codes']) ? result['error-codes'].join(',') : 'unknown';
    return { ok: false, reason: codes || 'not-success' };
  }
  if (result.action !== EXPECTED_ACTION) return { ok: false, reason: `action-${result.action || 'none'}` };
  if (!allowed.has(result.hostname)) return { ok: false, reason: `hostname-${result.hostname || 'none'}` };
  return { ok: true, reason: '' };
}

async function handleContact(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json(400, { ok: false, error: 'Please fill in the form and try again.' });
  }

  // Honeypot field: real visitors never see or fill it.
  if (cleanLine(form.get('website'), 200)) return json(200, { ok: true });

  const ip = request.headers.get('CF-Connecting-IP');
  const check = await verifyTurnstile(env, form.get('cf-turnstile-response'), ip);
  if (!check.ok) {
    console.warn('turnstile check failed:', check.reason);
    return json(403, { ok: false, error: `We could not confirm you are human. Please try again. (code: ${check.reason})` });
  }

  const data = {
    name: cleanLine(form.get('name'), LIMITS.name),
    email: cleanLine(form.get('email'), LIMITS.email),
    company: cleanLine(form.get('company'), LIMITS.company),
    timeline: cleanLine(form.get('timeline'), LIMITS.timeline),
    country: cleanLine(form.get('country'), LIMITS.country),
    message: cleanText(form.get('message'), LIMITS.message),
  };

  if (!data.name || !data.message) {
    return json(400, { ok: false, error: 'Please add your name and a short message.' });
  }
  if (!/^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/.test(data.email)) {
    return json(400, { ok: false, error: 'Please check your email address.' });
  }

  const text = [
    'New enquiry from the asakpns.com contact form',
    '',
    `Name:      ${data.name}`,
    `Email:     ${data.email}`,
    `Company:   ${data.company || '-'}`,
    `Timeline:  ${data.timeline || '-'}`,
    `Country:   ${data.country || '-'}`,
    '',
    'Message:',
    data.message,
    '',
    '--',
    'Press Reply to answer this person directly.',
  ].join('\n');

  const to = env.CONTACT_TO || 'hello@asakpns.com';
  const from = env.SMTP_USER;
  try {
    const message = buildMessage({
      from,
      fromName: 'ASAKPNS website',
      to,
      replyTo: data.email,
      subject: `Website enquiry from ${data.name}`,
      text,
      domain: 'asakpns.com',
    });
    await sendMail({
      host: env.SMTP_HOST || 'smtp.migadu.com',
      port: Number(env.SMTP_PORT || 465),
      secure: env.SMTP_TLS !== 'off',
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
      from,
      to,
      message,
      heloName: 'asakpns.com',
    });
  } catch (err) {
    console.error('contact form delivery failed:', err && err.message);
    return json(502, { ok: false, error: 'Sorry, your message could not be sent. Please email hello@asakpns.com instead.' });
  }

  return json(200, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
      return handleContact(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
