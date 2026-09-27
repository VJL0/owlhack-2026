/** Same-origin browser bridge to the Speech Engine process. No API key enters the browser. */
async function proxy(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const url = new URL("/session", process.env.SPEECH_SERVER_URL ?? "http://127.0.0.1:3001");
  url.search = new URL(req.url).search;
  try {
    const response = await fetch(url, {
      method: req.method,
      headers: { "content-type": "application/json", authorization: req.headers.get("authorization") ?? "" },
      body: req.method === "POST" || req.method === "PATCH" ? await req.text() : undefined,
      signal: req.signal,
      cache: "no-store",
    });
    return new Response(response.body, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Voice is unavailable. You can still type a question." }, { status: 503 });
  }
}
export { proxy as POST, proxy as GET, proxy as PATCH, proxy as DELETE };
