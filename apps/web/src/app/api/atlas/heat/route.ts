import { FORECAST_YEARS, getHeatYear, HISTORY_YEARS } from '@/lib/server/atlas';
import { CACHE_HEADERS, unavailable } from '@/lib/server/respond';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get('year') ?? '';
  const year = /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  const inRange = year >= HISTORY_YEARS[0] && year <= FORECAST_YEARS[1];
  if ([...params.keys()].some((k) => k !== 'year') || params.getAll('year').length !== 1 || !inRange) {
    return Response.json({ error: `year must be ${HISTORY_YEARS[0]}–${FORECAST_YEARS[1]}` }, { status: 400 });
  }
  try {
    const heat = await getHeatYear(year);
    // 2003 is missing from the supplied history and 2026 is in neither dataset: say so rather than invent it.
    if (!heat) return Response.json({ error: `No heat values for ${year} in the supplied data` }, { status: 404, headers: CACHE_HEADERS });
    return Response.json(heat, { headers: CACHE_HEADERS });
  } catch {
    return unavailable('Heat layer');
  }
}
