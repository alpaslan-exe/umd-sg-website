/**
 * umdsg-cms-auth: sign-in for Sveltia CMS without GitHub accounts.
 *
 * MODE A (preferred): Cloudflare Access. The Worker is protected by Access with a One-time PIN
 * policy that allows only the board mailing list. Cloudflare emails the PIN from its own domain
 * (no greylisting), and the request reaches this Worker carrying a signed JWT. We verify the JWT
 * (signature, issuer, audience, expiry, email) and hand the CMS its GitHub token. Enabled when
 * ACCESS_TEAM_DOMAIN and ACCESS_AUD are set.
 *
 * MODE B (fallback): our own emailed one-time code via Brevo, described below.
 *
 * Flow: the CMS opens `/auth?provider=github&site_id=<host>` in a popup. The page asks the worker
 * to email a 6-digit code to the board mailing list (MAIL_TO). When the code is verified the worker
 * returns a GitHub token, and the page hands it to the CMS with the same postMessage handshake the
 * official Sveltia authenticator uses.
 *
 * Security properties:
 *  - Codes are random (crypto), hashed at rest, expire in 10 minutes, max 5 attempts, single use.
 *  - Sending is rate-limited per IP and globally so the list cannot be flooded.
 *  - The popup only releases the token to an opener whose origin matches ALLOWED_DOMAINS.
 *  - The GitHub token is a secret on the worker; it never appears in the repo or in email.
 *  - The trade-off chosen by SG: anyone who can read the board list can sign in. Keep the list current.
 */

const CODE_TTL = 900; // seconds (15 min: umich greylisting can delay delivery a few minutes)
const MAX_ATTEMPTS = 5;
const SEND_LIMIT_PER_IP = 5; // per 10 minutes
const SEND_LIMIT_GLOBAL = 40; // per hour

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const domainPatterns = (list) =>
  (list ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => `^${escapeRegExp(s).replaceAll('\\*', '.+')}$`);
const domainAllowed = (env, host) => {
  const patterns = domainPatterns(env.ALLOWED_DOMAINS);
  return patterns.length === 0 || patterns.some((p) => new RegExp(p).test(host ?? ''));
};
const serialize = (v) => JSON.stringify(v ?? null).replaceAll('<', '\\u003c');
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const sha256 = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
const randomCode = () => {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
};
const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};
const getCookie = (request, name) => request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]+)`))?.[1];
const clientIp = (request) => request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';

async function bump(env, key, ttl) {
  const cur = Number((await env.OTP_KV.get(key)) ?? 0) + 1;
  await env.OTP_KV.put(key, String(cur), { expirationTtl: ttl });
  return cur;
}

async function sendMail(env, { code, ip, ua, site }) {
  const expires = new Date(Date.now() + CODE_TTL * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', minute: '2-digit' });
  const text = [
    `Your one-time sign-in code for the ${env.SITE_NAME} website editor is:`,
    '',
    `    ${code}`,
    '',
    `It expires at ${expires} (Detroit time) and works once.`,
    `Request came from ${site} (IP ${ip}).`,
    '',
    'If nobody on the board is signing in right now, ignore this email; the code cannot be used without the browser that requested it.',
  ].join('\n');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME ?? env.SITE_NAME },
      to: [{ email: env.MAIL_TO }],
      subject: `${code} is your ${env.SITE_NAME} editor code`,
      textContent: text,
      headers: { 'X-Requested-From': `${site} ${ip} ${ua}`.slice(0, 200) },
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function page(env, { provider, site, error }) {
  const trusted = serialize(domainPatterns(env.ALLOWED_DOMAINS));
  const body = error
    ? `<h1>Sign-in unavailable</h1><p class="err">${error}</p>`
    : `
      <h1>Editor sign-in</h1>
      <p>A one-time code will be emailed to the Student Government board inbox<br><strong>${env.MAIL_TO}</strong>.</p>
      <form id="send"><button type="submit" class="primary">Email me a code</button></form>
      <form id="verify" hidden>
        <label for="code">Enter the 6-digit code</label>
        <input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
        <button type="submit" class="primary">Sign in</button>
        <button type="button" id="resend" class="link">Send a new code</button>
      </form>
      <p id="msg" class="msg" role="status"></p>`;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${env.SITE_NAME} editor sign-in</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#00274c;color:#fff;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{width:min(92vw,440px);background:#fff;color:#14202e;border:6px solid #ffcb05;border-radius:16px;padding:1.6rem 1.8rem}
  h1{font-family:Georgia,serif;color:#00274c;margin:0 0 .6rem;font-size:1.6rem}
  p{margin:0 0 1rem}label{display:block;font-weight:700;margin-bottom:.4rem}
  input{width:100%;box-sizing:border-box;font-size:1.6rem;letter-spacing:.35em;text-align:center;padding:.5rem;border:2px solid #dfe3e8;border-radius:10px;margin-bottom:.9rem}
  button.primary{width:100%;padding:.8rem;border:0;border-radius:999px;background:#ffcb05;color:#00274c;font-weight:700;font-size:1rem;cursor:pointer}
  button.primary:disabled{opacity:.6;cursor:wait}
  button.link{background:none;border:0;color:#0b4a8a;text-decoration:underline;margin-top:.8rem;cursor:pointer;font-size:.95rem}
  .msg{min-height:1.4em;color:#5b6573;font-size:.95rem}.err{color:#b00020}
</style></head><body><main>${body}</main>
<script>
(() => {
  const provider = ${serialize(provider)};
  const trustedPatterns = ${trusted};
  const isTrusted = (origin) => { try { const { hostname } = new URL(origin); return trustedPatterns.length === 0 || trustedPatterns.some((p) => new RegExp(p).test(hostname)); } catch { return false; } };
  const $ = (s) => document.querySelector(s);
  const msg = (t, err) => { const m = $('#msg'); if (m) { m.textContent = t; m.className = err ? 'msg err' : 'msg'; } };
  const post = async (path, body) => { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error ?? ('HTTP ' + r.status)); return d; };
  const deliver = (token) => {
    const handler = ({ data, origin }) => {
      if (data !== 'authorizing:' + provider) return;
      if (!isTrusted(origin)) return;
      window.removeEventListener('message', handler);
      window.opener?.postMessage('authorization:' + provider + ':success:' + JSON.stringify({ provider, token }), origin);
    };
    window.addEventListener('message', handler);
    window.opener?.postMessage('authorizing:' + provider, '*');
    msg('Signed in. You can close this window.');
  };
  const send = async (btn) => {
    btn && (btn.disabled = true); msg('Sending code…');
    try { await post('/otp/send', { site: location.search }); $('#send').hidden = true; $('#verify').hidden = false; $('#code').focus(); msg('Code sent to the board inbox. Check email (and spam) and enter it here within 15 minutes. Delivery can take a few minutes.'); }
    catch (e) { msg(e.message, true); }
    finally { btn && (btn.disabled = false); }
  };
  $('#send')?.addEventListener('submit', (e) => { e.preventDefault(); send(e.submitter); });
  $('#resend')?.addEventListener('click', (e) => send(e.target));
  $('#verify')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = e.submitter; btn.disabled = true; msg('Checking…');
    try { const { token } = await post('/otp/verify', { code: $('#code').value.trim() }); deliver(token); }
    catch (err) { msg(err.message, true); btn.disabled = false; }
  });
})();
</script></body></html>`,
    { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'" } },
  );
}

/* ---------------- Cloudflare Access mode ---------------- */

const b64urlToBytes = (str) => {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const decodeSegment = (seg) => JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));

let certsCache = { at: 0, keys: [] };
async function getAccessKeys(teamDomain) {
  if (Date.now() - certsCache.at < 5 * 60e3 && certsCache.keys.length) return certsCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const { keys = [] } = await res.json();
  certsCache = { at: Date.now(), keys };
  return keys;
}

/** Verify a Cloudflare Access JWT. Returns the payload or throws. */
async function verifyAccessJwt(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = decodeSegment(parts[0]);
  const payload = decodeSegment(parts[1]);
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  const keys = await getAccessKeys(env.ACCESS_TEAM_DOMAIN);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('token expired');
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) throw new Error('token not yet valid');
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new Error('wrong issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new Error('wrong audience');
  const email = String(payload.email ?? '').toLowerCase();
  if (!email) throw new Error('no email in token');
  const allowed = (env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) throw new Error(`email ${email} not allowed`);
  return payload;
}

function accessPage(env, { provider, site, token, error }) {
  const trusted = serialize(domainPatterns(env.ALLOWED_DOMAINS));
  const body = error
    ? `<h1>Sign-in unavailable</h1><p class="err">${error}</p>`
    : `<h1>Signed in</h1><p id="msg" class="msg" role="status">Handing off to the editor… you can close this window once it loads.</p>`;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${env.SITE_NAME} editor sign-in</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#00274c;color:#fff;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}main{width:min(92vw,440px);background:#fff;color:#14202e;border:6px solid #ffcb05;border-radius:16px;padding:1.6rem 1.8rem}h1{font-family:Georgia,serif;color:#00274c;margin:0 0 .6rem;font-size:1.6rem}.msg{color:#5b6573}.err{color:#b00020}</style>
</head><body><main>${body}</main>
<script>
(() => {
  const provider = ${serialize(provider)}; const token = ${serialize(token ?? null)};
  const trustedPatterns = ${trusted};
  const isTrusted = (origin) => { try { const { hostname } = new URL(origin); return trustedPatterns.length === 0 || trustedPatterns.some((p) => new RegExp(p).test(hostname)); } catch { return false; } };
  if (!token) return;
  window.addEventListener('message', ({ data, origin }) => {
    if (data !== 'authorizing:' + provider || !isTrusted(origin)) return;
    window.opener?.postMessage('authorization:' + provider + ':success:' + JSON.stringify({ provider, token }), origin);
    const m = document.getElementById('msg'); if (m) m.textContent = 'Signed in. You can close this window.';
  });
  window.opener?.postMessage('authorizing:' + provider, '*');
})();
</script></body></html>`,
    { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'" } },
  );
}

async function handleAccessAuth(request, env) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider') ?? 'github';
  const site = searchParams.get('site_id') ?? '';
  if (provider !== 'github') return accessPage(env, { provider, site, error: 'Only the GitHub backend is supported.' });
  if (!domainAllowed(env, site)) return accessPage(env, { provider, site, error: 'This site is not allowed to use the authenticator.' });
  if (!env.GITHUB_TOKEN) return accessPage(env, { provider, site, error: 'The authenticator is not fully configured yet. Ask the Director of Technology.' });
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') ?? getCookie(request, 'CF_Authorization');
  if (!jwt) return accessPage(env, { provider, site, error: 'No Cloudflare Access session found. Make sure the Worker is protected by Access, then try again.' });
  try {
    const payload = await verifyAccessJwt(jwt, env);
    console.log(JSON.stringify({ event: 'access_signin', email: payload.email, site, ip: clientIp(request) }));
    return accessPage(env, { provider, site, token: env.GITHUB_TOKEN });
  } catch (err) {
    console.warn('access verify failed', err.message);
    const m = /^email (.+) not allowed$/.exec(err.message);
    const error = m
      ? `You signed in to Cloudflare as <strong>${m[1].replace(/[<>&]/g, '')}</strong>, which is not an editor address. Sign out of Cloudflare Access (open <a href="/cdn-cgi/access/logout">/cdn-cgi/access/logout</a>), then sign in with the board list address.`
      : `Your sign-in could not be verified (${err.message.replace(/[<>&]/g, '')}). Close this window and try again.`;
    return accessPage(env, { provider, site, error });
  }
}

/* ---------------- Emailed-code mode (fallback) ---------------- */

async function handleAuth(request, env) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider') ?? 'github';
  const site = searchParams.get('site_id') ?? '';
  if (provider !== 'github') return page(env, { provider, site, error: 'Only the GitHub backend is supported.' });
  if (!domainAllowed(env, site)) return page(env, { provider, site, error: 'This site is not allowed to use the authenticator.' });
  if (!env.BREVO_API_KEY || !env.GITHUB_TOKEN || !env.OTP_KV) return page(env, { provider, site, error: 'The authenticator is not fully configured yet. Ask the Director of Technology.' });
  const session = crypto.randomUUID().replaceAll('-', '');
  await env.OTP_KV.put(`sess:${session}`, JSON.stringify({ site, created: Date.now() }), { expirationTtl: 1800 });
  const res = page(env, { provider, site });
  res.headers.append('Set-Cookie', `otp-session=${session}; HttpOnly; Secure; Path=/; Max-Age=1800; SameSite=Lax`);
  return res;
}

async function handleSend(request, env) {
  const session = getCookie(request, 'otp-session');
  const sess = session ? await env.OTP_KV.get(`sess:${session}`, 'json') : null;
  if (!sess) return json({ error: 'Session expired. Close this window and sign in again.' }, 400);
  const ip = clientIp(request);
  if ((await bump(env, `rl:ip:${await sha256(ip)}`, 600)) > SEND_LIMIT_PER_IP) return json({ error: 'Too many codes requested. Try again in 10 minutes.' }, 429);
  if ((await bump(env, 'rl:global', 3600)) > SEND_LIMIT_GLOBAL) return json({ error: 'The sign-in service is busy. Try again later.' }, 429);
  const code = randomCode();
  await env.OTP_KV.put(`otp:${session}`, JSON.stringify({ hash: await sha256(`${session}:${code}`), attempts: 0 }), { expirationTtl: CODE_TTL });
  try {
    await sendMail(env, { code, ip, ua: request.headers.get('User-Agent') ?? '', site: sess.site || 'unknown site' });
  } catch (err) {
    console.error('mail failed', err.message);
    await env.OTP_KV.delete(`otp:${session}`);
    return json({ error: 'Could not send the email. Ask the Director of Technology to check the mail settings.' }, 502);
  }
  console.log(JSON.stringify({ event: 'otp_sent', site: sess.site, ip }));
  return json({ ok: true });
}

async function handleVerify(request, env) {
  const session = getCookie(request, 'otp-session');
  if (!session) return json({ error: 'Session expired. Close this window and sign in again.' }, 400);
  const { code } = await request.json().catch(() => ({}));
  if (!/^\d{6}$/.test(code ?? '')) return json({ error: 'Enter the 6-digit code.' }, 400);
  const key = `otp:${session}`;
  const rec = await env.OTP_KV.get(key, 'json');
  if (!rec) return json({ error: 'Code expired or already used. Send a new code.' }, 400);
  if (rec.attempts + 1 >= MAX_ATTEMPTS) { await env.OTP_KV.delete(key); return json({ error: 'Too many wrong attempts. Send a new code.' }, 429); }
  const ok = timingSafeEqual(rec.hash, await sha256(`${session}:${code}`));
  if (!ok) {
    await env.OTP_KV.put(key, JSON.stringify({ ...rec, attempts: rec.attempts + 1 }), { expirationTtl: CODE_TTL });
    return json({ error: `Wrong code. ${MAX_ATTEMPTS - rec.attempts - 1} attempts left.` }, 401);
  }
  await env.OTP_KV.delete(key);
  await env.OTP_KV.delete(`sess:${session}`);
  console.log(JSON.stringify({ event: 'otp_verified', ip: clientIp(request) }));
  return json({ token: env.GITHUB_TOKEN }, 200, { 'Set-Cookie': 'otp-session=deleted; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax' });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const accessMode = !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
    if (request.method === 'GET' && (pathname === '/auth' || pathname === '/')) return accessMode ? handleAccessAuth(request, env) : handleAuth(request, env);
    if (accessMode) return new Response('Not found', { status: 404 });
    if (request.method === 'POST' && pathname === '/otp/send') return handleSend(request, env);
    if (request.method === 'POST' && pathname === '/otp/verify') return handleVerify(request, env);
    return new Response('Not found', { status: 404 });
  },
};
