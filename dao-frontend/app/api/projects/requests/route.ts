import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const backend = process.env.DAO_BACKEND_URL;
  const authorization = request.headers.get('authorization');
  if (!backend) return NextResponse.json({ error: 'DAO_BACKEND_URL is not configured' }, { status: 503 });
  if (!authorization) return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  const response = await fetch(`${backend.replace(/\/$/, '')}/api/projects/requests`, {
    method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: await request.text(), cache: 'no-store',
  });
  return new NextResponse(await response.text(), { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json' } });
}
