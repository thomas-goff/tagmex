import { authorizationServerUrl } from '@/features/mcp/clerk';
import { METADATA_CORS, protectedResourceMetadata } from '@/features/mcp/server';

// RFC 9728 protected resource metadata: tells MCP clients that Clerk is the authorization server
// for /api/mcp. Served at the bare path and at /api/mcp (the path-aware form the 401 points to).
export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return Response.json(protectedResourceMetadata(origin, authorizationServerUrl()), {
    headers: { ...METADATA_CORS, 'Cache-Control': 'public, max-age=3600' },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_CORS });
}
