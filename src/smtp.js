// Minimal SMTP client for Cloudflare Workers (no dependencies).
// Sends one message over implicit TLS (port 465) with AUTH PLAIN.
import { connect } from 'cloudflare:sockets';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64Utf8(text) {
  const bytes = encoder.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Encoded-word for headers that may contain non-ASCII text (RFC 2047).
export function encodeHeader(text) {
  return /^[\x20-\x7E]*$/.test(text) ? text : `=?UTF-8?B?${base64Utf8(text)}?=`;
}

function wrap76(b64) {
  return b64.replace(/.{1,76}/g, '$&\r\n');
}

// Build a message: plain text, or plain text + HTML (multipart/alternative).
// Bodies are base64-encoded, so no dot-stuffing or line-length issues;
// header values must already be free of CR/LF.
export function buildMessage({ from, fromName, to, replyTo, subject, text, html, domain, extraHeaders = [] }) {
  const id = `${crypto.randomUUID()}@${domain}`;
  const headers = [
    `From: ${encodeHeader(fromName)} <${from}>`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}>`,
    ...extraHeaders,
    'MIME-Version: 1.0',
  ].filter(Boolean);
  if (!html) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${wrap76(base64Utf8(text))}`;
  }
  const boundary = `asakpns-${crypto.randomUUID()}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const part = (type, body) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=utf-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(base64Utf8(body)),
  ].join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${part('text/plain', text)}\r\n${part('text/html', html)}\r\n--${boundary}--`;
}

export async function sendMail({ host, port, secure = true, user, pass, from, to, message, heloName, timeoutMs = 15000 }) {
  const socket = connect({ hostname: host, port }, { secureTransport: secure ? 'on' : 'off' });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let buffer = '';

  async function readReply() {
    for (;;) {
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        const m = line.match(/^(\d{3})([ -])(.*)$/);
        if (m && m[2] === ' ') return { code: Number(m[1]), text: m[3] };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP connection closed unexpectedly');
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function expect(codes, label) {
    const reply = await readReply();
    if (!codes.includes(reply.code)) throw new Error(`SMTP ${label} failed: ${reply.code}`);
    return reply;
  }

  async function command(line, codes, label) {
    await writer.write(encoder.encode(`${line}\r\n`));
    return expect(codes, label);
  }

  const run = (async () => {
    await expect([220], 'greeting');
    await command(`EHLO ${heloName}`, [250], 'EHLO');
    await command(`AUTH PLAIN ${base64Utf8(`\u0000${user}\u0000${pass}`)}`, [235], 'AUTH');
    await command(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');
    await command(`RCPT TO:<${to}>`, [250, 251], 'RCPT TO');
    await command('DATA', [354], 'DATA');
    await writer.write(encoder.encode(`${message}\r\n.\r\n`));
    await expect([250], 'message');
    try { await command('QUIT', [221], 'QUIT'); } catch { /* the message is already accepted */ }
  })();

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('SMTP timeout')), timeoutMs);
  });
  try {
    await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
    try { await socket.close(); } catch { /* ignore */ }
  }
}
