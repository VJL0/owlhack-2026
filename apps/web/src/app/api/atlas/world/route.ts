import { getWorld } from '@/lib/server/atlas';
import { CACHE_HEADERS, unavailable } from '@/lib/server/respond';

export const runtime = 'nodejs';
export async function GET() {
  try {
    return Response.json(await getWorld(), { headers: CACHE_HEADERS });
  } catch {
    return unavailable('World reef index');
  }
}
