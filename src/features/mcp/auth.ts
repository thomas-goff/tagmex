import { bearerAuthChallengeResponse, OAuthError, OAuthErrorCode, type AuthInfo } from '@modelcontextprotocol/server';

// The MCP endpoint is an OAuth protected resource; Clerk is its authorization server. Every request
// needs a bearer token Clerk verifies, belonging to a Clerk user linked to an app user. The token's
// verification is the only source of the user id the tools run as.

export interface VerifiedToken {
  clerkUserId: string;
  clientId: string;
  scopes: string[];
  // Seconds since the epoch, when known.
  expiresAt?: number;
}

export interface Principal {
  // The app's user id (user_id on every table), not the Clerk id.
  userId: string;
  clerkUserId: string;
  clientId: string;
  scopes: string[];
}

export interface AuthDeps {
  // Null for an unknown, expired or revoked token. Throws only when verification itself failed.
  verifyToken(token: string): Promise<VerifiedToken | null>;
  // The app user a Clerk user maps to, or null when they aren't allowed in.
  resolveUserId(clerkUserId: string): Promise<string | null>;
  // Advertised on 401s so clients can discover the authorization server (RFC 9728).
  resourceMetadataUrl: string;
}

export async function authenticate(
  request: Request,
  { verifyToken, resolveUserId, resourceMetadataUrl }: AuthDeps,
): Promise<{ principal: Principal; authInfo: AuthInfo } | Response> {
  const challenge = (message: string) =>
    bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InvalidToken, message), { resourceMetadataUrl });

  const token = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return challenge('Missing bearer token');

  let verified: VerifiedToken | null;
  try {
    verified = await verifyToken(token);
  } catch (err) {
    console.error('MCP token verification failed', err);
    return bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.ServerError, 'Token verification failed'));
  }
  if (!verified) return challenge('Invalid, expired or revoked token');

  let userId: string | null;
  try {
    userId = await resolveUserId(verified.clerkUserId);
  } catch (err) {
    console.error('MCP user lookup failed', err);
    return bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.ServerError, 'User lookup failed'));
  }
  if (!userId) {
    return Response.json(
      { error: 'access_denied', error_description: 'This account is not allowed to use tagmex.' },
      { status: 403 },
    );
  }

  const principal: Principal = { userId, clerkUserId: verified.clerkUserId, clientId: verified.clientId, scopes: verified.scopes };
  return {
    principal,
    authInfo: {
      token,
      clientId: verified.clientId,
      scopes: verified.scopes,
      expiresAt: verified.expiresAt,
      resourceMetadataUrl,
      extra: { principal },
    },
  };
}

export function principalOf(authInfo: AuthInfo | undefined): Principal | null {
  const principal = authInfo?.extra?.principal as Principal | undefined;
  return principal && typeof principal.userId === 'string' ? principal : null;
}
