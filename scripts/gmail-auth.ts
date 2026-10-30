// One-off: runs the Google consent flow locally and prints a gmail.readonly refresh token.
// Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (a "Desktop app" OAuth client) in .env.local.
// Usage: npm run gmail:auth
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local');

const state = randomBytes(16).toString('hex');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  const code = url.searchParams.get('code');
  if (!code) return res.writeHead(404).end();
  if (url.searchParams.get('state') !== state) return res.writeHead(400).end('State mismatch');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const body = (await tokenRes.json()) as { refresh_token?: string; error?: string };
  res.end(body.refresh_token ? 'Done. You can close this tab.' : 'Failed, see the terminal.');
  server.close();

  if (!body.refresh_token) {
    console.error('No refresh token returned:', body);
    process.exitCode = 1;
    return;
  }
  console.log('\nGMAIL_REFRESH_TOKEN=' + body.refresh_token);
  console.log('\nAdd it to .env.local and to the Vercel project env vars.');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/gmail.readonly',
  access_type: 'offline',
  prompt: 'consent', // always issue a fresh refresh token
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

console.log('Open this URL and approve access:\n\n' + authUrl.toString());
