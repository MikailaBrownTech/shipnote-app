// Uptime check. Reads no cookies, database, Redis or env var, and the proxy
// skips /api/health, so no session check runs here.

const headers = { 'Cache-Control': 'no-store' }

export function GET() {
  return Response.json({ ok: true }, { headers })
}

const notAllowed = () =>
  new Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } })

export const POST = notAllowed
export const PUT = notAllowed
export const PATCH = notAllowed
export const DELETE = notAllowed
