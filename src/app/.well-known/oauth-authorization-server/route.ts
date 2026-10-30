import { authorizationServerUrl } from '@/features/mcp/clerk';
import { METADATA_CORS } from '@/features/mcp/server';

// RFC 8414 metadata for older MCP clients that look for the authorization server on the resource's
// own origin. Clerk's own document, passed through.
export async function GET() {
  const res = await fetch(`${authorizationServerUrl()}/.well-known/oauth-authorization-server`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) return Response.json({ error: 'authorization server metadata unavailable' }, { status: 502 });
  return Response.json(await res.json(), { headers: { ...METADATA_CORS, 'Cache-Control': 'public, max-age=3600' } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_CORS });
}
