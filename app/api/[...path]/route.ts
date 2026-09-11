import { NextRequest } from 'next/server';

/**
 * Server-side proxy to the API (Replit in production, bundled server locally).
 *
 * Browser → Next.js → Replit API → xKiro → MiniMax M3.
 * Credentials live only in this process; the browser never sees them.
 */

const BASE = (process.env.REPLIT_API_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const INTERNAL_KEY = process.env.REPLIT_API_KEY || '';

async function forward(request: NextRequest, segments: string[]) {
  const target = `${BASE}/api/${segments.join('/')}${request.nextUrl.search ?? ''}`;
  const headers = new Headers();

  const passThrough = ['content-type', 'accept', 'x-sipium-key', 'x-forwarded-for'];
  for (const name of passThrough) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (INTERNAL_KEY) headers.set('x-sipium-internal-key', INTERNAL_KEY);

  const method = request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const upstream = await fetch(target, {
    method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    // Streaming responses (AI build) must reach the browser as they arrive.
    duplex: hasBody ? 'half' : undefined,
    cache: 'no-store',
    redirect: 'manual',
  } as RequestInit);

  const responseHeaders = new Headers();
  const copy = ['content-type', 'cache-control'];
  for (const name of copy) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

type Context = { params: Promise<{ path: string[] }> };

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PATCH(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PUT(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function DELETE(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return forward(request, path);
}
