import { getFlorida } from '@/lib/server/atlas';
import { CACHE_HEADERS, unavailable } from '@/lib/server/respond';

export const runtime = 'nodejs';
export async function GET() {
  try {
    return Response.json(await getFlorida(), { headers: CACHE_HEADERS });
  } catch {
    return unavailable('Florida data');
  }
}
