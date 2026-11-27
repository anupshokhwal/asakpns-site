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

async function handleContact(request, env, ctx) {
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

  // Thank-you email to the visitor. Fixed wording only (nothing they typed is
  // echoed back), so the form cannot be used to send spam to other people.
  // Sent after the response; a failure here does not affect the enquiry.
  ctx.waitUntil(sendConfirmation(env, data.email).catch((err) => {
    console.error('confirmation email failed:', err && err.message);
  }));

  return json(200, { ok: true });
}

const CONFIRM_TEXT = [
  'Hi,',
  '',
  'Thanks for getting in touch through our website. Just a quick note to say your message arrived safely.',
  '',
  "We'll read it properly and get back to you within two working days. If you'd like to add anything in the meantime, such as what you have in mind, your timeline or where you're based, simply reply to this email.",
  '',
  'Speak soon,',
  'The ASAKPNS team',
  'asakpns.com',
].join('\n');

const CONFIRM_HTML = `<html><body style="margin:0;padding:24px 12px;background:#F4F6FB;font-family:Arial,Helvetica,sans-serif;color:#0E1633">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:12px;border:1px solid #DDE3F0">
<tr><td style="padding:28px 32px 8px"><img src="https://asakpns.com/email-logo.png" width="184" height="40" alt="ASAKPNS" style="display:block;border:0"></td></tr>
<tr><td style="padding:12px 32px 24px;font-size:15px;line-height:1.6;color:#0E1633">
<p style="margin:0 0 14px">Hi,</p>
<p style="margin:0 0 14px">Thanks for getting in touch through our website. Just a quick note to say your message arrived safely.</p>
<p style="margin:0 0 14px">We'll read it properly and get back to you within two working days. If you'd like to add anything in the meantime, such as what you have in mind, your timeline or where you're based, simply reply to this email.</p>
<p style="margin:0">Speak soon,<br>The ASAKPNS team</p>
</td></tr>
<tr><td style="padding:16px 32px 20px;border-top:1px solid #DDE3F0;font-size:13px;color:#47506B">Trust &middot; Transparency &middot; Security &nbsp;|&nbsp; <a href="https://asakpns.com" style="color:#0A4BF7;text-decoration:none">asakpns.com</a></td></tr>
</table>
</body></html>`;

async function sendConfirmation(env, visitorEmail) {
  const from = env.SMTP_USER;
  const message = buildMessage({
    from,
    fromName: 'ASAKPNS',
    to: visitorEmail,
    subject: 'Thanks for contacting ASAKPNS',
    text: CONFIRM_TEXT,
    html: CONFIRM_HTML,
    domain: 'asakpns.com',
    extraHeaders: ['Auto-Submitted: auto-replied'],
  });
  await sendMail({
    host: env.SMTP_HOST || 'smtp.migadu.com',
    port: Number(env.SMTP_PORT || 465),
    secure: env.SMTP_TLS !== 'off',
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
    from,
    to: visitorEmail,
    message,
    heloName: 'asakpns.com',
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // One address for search engines: send www.asakpns.com to asakpns.com
    // (permanent redirect, same path and query). Form posts are left alone.
    if (url.hostname === 'www.asakpns.com' && (request.method === 'GET' || request.method === 'HEAD')) {
      url.hostname = 'asakpns.com';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
      return handleContact(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
