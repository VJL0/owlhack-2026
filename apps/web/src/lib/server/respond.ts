import 'server-only';

// Shared response policy for dataset routes: browsers keep 60 s, a shared cache 300 s.
// Failures never reveal connection details and are never cached.
export const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=300' };

export function unavailable(what: string) {
  console.error(`${what} query failed`);
  return Response.json({ error: 'Reef data is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
}
