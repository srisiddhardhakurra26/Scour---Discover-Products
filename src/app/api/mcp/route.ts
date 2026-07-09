import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { buildScourMcpServer } from '@/lib/mcp-server'

export const runtime = 'nodejs'

// Remote MCP clients (Claude, ChatGPT, web inspectors) may preflight.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version',
  'access-control-expose-headers': 'mcp-session-id',
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

async function handle(req: Request) {
  // Optional shared-secret gate: set MCP_API_KEY to require
  // "Authorization: Bearer <key>" from clients that support custom headers.
  const key = process.env.MCP_API_KEY
  if (key && req.headers.get('authorization') !== `Bearer ${key}`) {
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
      { status: 401, headers: CORS },
    )
  }

  // Stateless: a fresh server + transport per request. No session state to
  // share, and every tool call is independently safe to retry.
  const server = buildScourMcpServer(new URL(req.url).origin)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return withCors(await transport.handleRequest(req))
}

export { handle as GET, handle as POST, handle as DELETE }
