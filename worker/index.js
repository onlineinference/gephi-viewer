// Cloudflare Worker: read-only API in front of the R2 bucket holding .gexf files.
//   GET  /api/index        -> [{ name, url }, ...]   (from GEPHI.list())
//   GET  /api/file/:name   -> raw .gexf file body, Content-Type: application/xml
//   POST /api/ask          -> { answer } — Workers AI answers a question about the
//                             currently-loaded graph, using a digest the viewer
//                             computed client-side (stats, hubs, relevant nodes).
//
// No write/upload route is exposed here on purpose — pushing files into R2 is done
// out-of-band via `wrangler r2 object put` or the dashboard (see BUILD-BRIEF.md).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ASK_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Server-side caps so a hostile client can't stuff the model context.
const MAX_DIGEST_CHARS = 16000;
const MAX_QUESTION_CHARS = 2000;
const MAX_HISTORY_TURNS = 8;

async function handleAsk(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const question = String(body.question || "").slice(0, MAX_QUESTION_CHARS).trim();
  const digest = String(body.digest || "").slice(0, MAX_DIGEST_CHARS);
  if (!question) {
    return Response.json({ error: "Missing question" }, { status: 400, headers: CORS_HEADERS });
  }

  const history = Array.isArray(body.history)
    ? body.history
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    : [];

  const messages = [
    {
      role: "system",
      content:
        "You are a graph-analysis assistant embedded in a Gephi (GEXF) network viewer. " +
        "Answer the user's questions about the currently loaded graph using ONLY the digest below, " +
        "which was computed from the actual graph data. If the digest doesn't contain enough " +
        "information to answer, say so and suggest what to look at instead of guessing. " +
        "Be concise; use node labels (not internal ids) when naming nodes.\n\n" +
        "=== GRAPH DIGEST ===\n" + digest,
    },
    ...history,
    { role: "user", content: question },
  ];

  try {
    const result = await env.AI.run(ASK_MODEL, { messages, max_tokens: 900 });
    return Response.json({ answer: result.response ?? "" }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("Workers AI error:", e);
    return Response.json({ error: "AI request failed" }, { status: 502, headers: CORS_HEADERS });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/ask" && request.method === "POST") {
      return handleAsk(request, env);
    }

    if (url.pathname === "/api/index") {
      if (!env.GEPHI) return Response.json([], { headers: CORS_HEADERS });
      const listed = await env.GEPHI.list();
      const files = listed.objects
        .filter((o) => o.key.toLowerCase().endsWith(".gexf"))
        .map((o) => ({ name: o.key, url: `/api/file/${encodeURIComponent(o.key)}` }));
      return Response.json(files, { headers: CORS_HEADERS });
    }

    const fileMatch = url.pathname.match(/^\/api\/file\/(.+)$/);
    if (fileMatch) {
      if (!env.GEPHI) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
      const key = decodeURIComponent(fileMatch[1]);
      const obj = await env.GEPHI.get(key);
      if (!obj) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
      return new Response(obj.body, {
        headers: { "Content-Type": "application/xml", ...CORS_HEADERS },
      });
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
