import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { authenticate, principalOf, type AuthDeps } from './auth';
import { registerPrompts } from './prompts';
import { registerTools, type ToolDeps } from './tool';
import { CYCLE_NOTE, MONEY_NOTE, READ_TOOLS, UNTRUSTED_NOTE } from './tools/read';
import { WRITE_TOOLS } from './tools/write';

export const TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

const INSTRUCTIONS = [
  'tagmex is a personal budget built from bank notification emails (Absa), in South African rand.',
  'Start with get_budget_overview for any "how am I doing / what can I spend" question: it answers most in one call.',
  CYCLE_NOTE,
  MONEY_NOTE,
  UNTRUSTED_NOTE,
  'Accounts show as the bank\'s type and last 4 digits; list_accounts has the names the user gave them, each account\'s latest balance and the counterparties they named.',
  'Money moved into a savings category counts as saved, not spent.',
  'Only change data (categorise, budgets, categories, rules, settings, exclusions, added or split transactions) when the user asks or agrees; tools that would change many rows return a preview first and need confirm: true.',
].join(' ');

// What the server says about itself on initialize. The icons are the app's own favicons
// (src/app/icon*, public/web-app-manifest-*), served from whichever host the request came in on.
// claude.ai doesn't use them yet: it shows a Google favicon for the last two labels of the
// connector's hostname (on *.vercel.app, Vercel's logo), so only a custom domain changes it there.
export function serverInfo(request?: Request) {
  const info = { name: 'tagmex', title: 'tagmex', version: '0.4.0' };
  if (!request) return info;
  const origin = new URL(request.url).origin;
  return {
    ...info,
    websiteUrl: origin,
    icons: [
      { src: `${origin}/icon1.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
      { src: `${origin}/icon2.png`, mimeType: 'image/png', sizes: ['96x96'] },
      { src: `${origin}/web-app-manifest-192x192.png`, mimeType: 'image/png', sizes: ['192x192'] },
      { src: `${origin}/web-app-manifest-512x512.png`, mimeType: 'image/png', sizes: ['512x512'] },
    ],
  };
}

export interface EndpointDeps {
  tools: ToolDeps;
  // Built per request: the metadata URL depends on the host the request came in on.
  auth: (request: Request) => AuthDeps;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
};

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// The /api/mcp request handler: OAuth bearer check, then the MCP SDK's stateless HTTP handler
// (2026-07-28 protocol, with the 2025 stateless fallback for older clients).
export function createMcpEndpoint({ tools, auth }: EndpointDeps) {
  // A fresh server per request (stateless), bound to that request's verified user.
  const handler = createMcpHandler(
    ({ authInfo, requestInfo }) => {
      const principal = principalOf(authInfo);
      if (!principal) throw new Error('MCP request reached the handler without a verified principal');
      const server = new McpServer(serverInfo(requestInfo), { instructions: INSTRUCTIONS });
      registerTools(server, TOOLS, { principal, deps: tools });
      registerPrompts(server);
      return server;
    },
    { onerror: (err) => console.error('MCP handler error', err) },
  );

  return async function handle(request: Request) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    const authed = await authenticate(request, auth(request));
    if (authed instanceof Response) return withCors(authed);
    return withCors(await handler.fetch(request, { authInfo: authed.authInfo }));
  };
}

// RFC 9728: where clients find our authorization server. Path-aware, so the document for
// https://host/api/mcp lives at https://host/.well-known/oauth-protected-resource/api/mcp.
export const MCP_PATH = '/api/mcp';

export function resourceUrl(origin: string) {
  return `${origin}${MCP_PATH}`;
}

export function resourceMetadataUrl(origin: string) {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

export function protectedResourceMetadata(origin: string, authorizationServer: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [authorizationServer],
    scopes_supported: ['profile', 'email'],
    bearer_methods_supported: ['header'],
    resource_name: 'tagmex',
  };
}

export { CORS as METADATA_CORS };
