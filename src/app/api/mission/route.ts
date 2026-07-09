import { runMission } from '@/lib/mission'

export const runtime = 'nodejs'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req: Request) {
  let body: { mission?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400, headers: CORS })
  }

  const mission = typeof body.mission === 'string' ? body.mission.trim() : ''
  if (!mission) {
    return Response.json({ error: 'mission is required.' }, { status: 400, headers: CORS })
  }
  if (mission.length > 500) {
    return Response.json({ error: 'mission too long (max 500 chars).' }, { status: 400, headers: CORS })
  }

  const origin = new URL(req.url).origin

  try {
    const result = await runMission(mission, { baseUrl: origin })
    return Response.json(result, {
      headers: { ...CORS, 'content-type': 'application/json' },
    })
  } catch (err) {
    console.error('[mission]', err)
    return Response.json({ error: 'Mission failed.' }, { status: 500, headers: CORS })
  }
}
