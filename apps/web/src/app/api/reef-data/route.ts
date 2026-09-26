import { getReefData } from '@/lib/server/reef-data';
import { InvalidFilter, parseFilters } from '../../../../database/filters.mjs';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const filters = parseFilters(new URL(request.url).searchParams);
    return Response.json(await getReefData(filters), { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
  } catch (error) {
    if (error instanceof InvalidFilter) return Response.json({ error: error.message }, { status: 400 });
    console.error('Reef data query failed');
    return Response.json({ error: 'Reef data is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
  }
}
