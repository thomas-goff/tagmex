// Clerk's Frontend API URL, which is also its OAuth authorization server (issuer), is encoded in the
// publishable key: pk_test_<base64("my-app.clerk.accounts.dev$")>.
export function frontendApiUrl(publishableKey: string) {
  const m = /^pk_(test|live)_(.+)$/.exec(publishableKey.trim());
  if (!m) throw new Error('CLERK_PUBLISHABLE_KEY must start with pk_test_ or pk_live_');
  const host = Buffer.from(m[2]!, 'base64').toString('utf8').replace(/\$$/, '');
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error('CLERK_PUBLISHABLE_KEY does not encode a host');
  return `https://${host}`;
}
