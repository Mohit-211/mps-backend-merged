import express, { Request, Response } from 'express';

// Development only (mounted by app.ts when NODE_ENV=development, never in test or production):
// a minimal page to connect a Google account with the GIS popup flow without the real frontend.
// It calls the same API as the frontend (GET /user/auth/google/gbp/popup, POST /user/auth/google/gbp/code).
// The MyPageSEO token is pasted by the developer and kept in memory only; nothing is stored or logged.

const router = express.Router();

// helmet's app-wide CSP blocks Google's GIS script; this page gets its own policy
// (https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#content_security_policy).
const CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client",
	"style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
	'frame-src https://accounts.google.com/gsi/',
	"connect-src 'self' https://accounts.google.com/gsi/",
].join('; ');

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GBP connect (dev)</title>
<script src="https://accounts.google.com/gsi/client" async></script>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 760px; margin: 32px auto; padding: 0 16px; }
  input { width: 100%; padding: 6px; font: inherit; box-sizing: border-box; }
  button { font: inherit; padding: 6px 14px; margin: 8px 8px 0 0; }
  pre { background: #f4f4f4; padding: 12px; white-space: pre-wrap; word-break: break-all; }
  .note { color: #555; font-size: 13px; }
</style>
</head>
<body>
<h1>GBP connect (development only)</h1>
<p class="note">Uses the same API as the frontend: GET /api/v1/user/auth/google/gbp/popup, then POST /api/v1/user/auth/google/gbp/code.
The token stays in this page's memory only.</p>
<label>MyPageSEO access token (from <code>npm run setup:live-test -- --token-only</code>)
  <input id="token" type="password" autocomplete="off">
</label>
<div>
  <button id="prepare">1. Prepare</button>
  <button id="connect" disabled>2. Connect Google account</button>
  <button id="profiles" disabled>3. List profiles (GBP calls: 1 + 1 per account)</button>
</div>
<h3>Result</h3>
<pre id="out">Paste the token, then click 1.</pre>
<script>
  const out = document.getElementById('out');
  const show = (label, value) => { out.textContent = label + '\\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 2)); };
  const token = () => document.getElementById('token').value.trim();
  const api = async (method, path, body) => {
    const res = await fetch('/api/v1' + path, {
      method,
      headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  let codeClient = null;

  document.getElementById('prepare').onclick = async () => {
    if (!token()) return show('Error', 'Paste the token first.');
    if (!window.google || !google.accounts) return show('Error', 'Google Identity Services script not loaded yet; wait a second and retry.');
    const res = await api('GET', '/user/auth/google/gbp/popup');
    if (res.status !== 200) return show('GET /user/auth/google/gbp/popup → ' + res.status, res.body);
    const cfg = res.body.data;
    codeClient = google.accounts.oauth2.initCodeClient({
      ...cfg,
      callback: async ({ code, state, error }) => {
        if (error) return show('Google popup error', error);
        const done = await api('POST', '/user/auth/google/gbp/code', { code, state });
        show('POST /user/auth/google/gbp/code → ' + done.status, done.body);
        document.getElementById('connect').disabled = true; // each state works once: prepare again for another account
        document.getElementById('profiles').disabled = false;
      },
      error_callback: (err) => show('Google popup error', err && err.type ? err.type : String(err)),
    });
    document.getElementById('connect').disabled = false;
    show('Ready (state valid 10 minutes, works once)', { scope: cfg.scope, ux_mode: cfg.ux_mode, select_account: cfg.select_account });
  };

  document.getElementById('connect').onclick = () => codeClient && codeClient.requestCode();

  document.getElementById('profiles').onclick = async () => {
    const res = await api('GET', '/onboarding/gbp-profiles');
    show('GET /onboarding/gbp-profiles → ' + res.status, res.body);
  };
</script>
</body>
</html>
`;

router.get('/gbp-connect', (req: Request, res: Response) => {
	res.setHeader('Content-Security-Policy', CSP);
	res.setHeader('Cache-Control', 'no-store');
	res.type('html').send(PAGE);
});

export default router;
