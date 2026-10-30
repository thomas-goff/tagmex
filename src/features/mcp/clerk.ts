import 'server-only';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { z } from 'zod';
import type { VerifiedToken } from './auth';
import { frontendApiUrl } from './clerk-keys';

// Validated on first use rather than in @/env, so the app deploys before Clerk is set up.
const schema = z.object({
  CLERK_SECRET_KEY: z.string().regex(/^sk_(test|live)_/, 'must start with sk_test_ or sk_live_'),
  CLERK_PUBLISHABLE_KEY: z.string().regex(/^pk_(test|live)_/, 'must start with pk_test_ or pk_live_'),
});

let config: z.infer<typeof schema> | null = null;
let client: ClerkClient | null = null;

function clerkEnv() {
  return (config ??= schema.parse(process.env));
}

function clerk() {
  const env = clerkEnv();
  return (client ??= createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY }));
}

// Clerk's Frontend API: the OAuth authorization server MCP clients sign in through.
export function authorizationServerUrl() {
  return frontendApiUrl(clerkEnv().CLERK_PUBLISHABLE_KEY);
}

// Verifies a Clerk OAuth access token (opaque or JWT) with Clerk. Null when it's invalid, expired
// or revoked.
export async function verifyClerkToken(token: string): Promise<VerifiedToken | null> {
  const state = await clerk().authenticateRequest(new Request('https://tagmex.invalid/api/mcp', { headers: { authorization: `Bearer ${token}` } }), {
    acceptsToken: 'oauth_token',
  });
  if (!state.isAuthenticated) return null;
  const auth = state.toAuth();
  if (auth.tokenType !== 'oauth_token' || !auth.userId || !auth.clientId) return null;
  return { clerkUserId: auth.userId, clientId: auth.clientId, scopes: auth.scopes ?? [] };
}

// A Clerk user's verified email addresses, used once to link them to an app user.
export async function verifiedEmails(clerkUserId: string) {
  const user = await clerk().users.getUser(clerkUserId);
  return user.emailAddresses.filter((e) => e.verification?.status === 'verified').map((e) => e.emailAddress);
}
