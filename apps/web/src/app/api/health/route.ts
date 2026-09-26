// Liveness probe for Docker and Caddy. Route Handlers are not cached by default.
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
