import { handleMcpRequest } from '@/features/mcp';

// reprocess_failed_messages runs a sync, which is sized to finish inside this.
export const maxDuration = 60;

// The MCP server (streamable HTTP, stateless). Every request needs a Clerk OAuth bearer token; a
// request without one gets a 401 pointing at /.well-known/oauth-protected-resource/api/mcp.
export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
export const OPTIONS = handleMcpRequest;
