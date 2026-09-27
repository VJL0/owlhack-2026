import { getDocumentText, isDocumentId } from '@/lib/server/atlas';
import { CACHE_HEADERS, unavailable } from '@/lib/server/respond';

export const runtime = 'nodejs';
export async function GET(_request: Request, ctx: RouteContext<'/api/atlas/documents/[group]/[name]'>) {
  const { group, name } = await ctx.params;
  const id = `${group}/${name}`;
  if (!isDocumentId(id)) return Response.json({ error: 'Unknown document' }, { status: 404 });
  try {
    // The stored text is already JSON; send it as it is.
    return new Response(await getDocumentText(id), { headers: { ...CACHE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
  } catch {
    return unavailable('Atlas document');
  }
}
