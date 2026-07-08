// Cloudflare Worker: read-only API in front of the R2 bucket holding .gexf files.
//   GET /api/index        -> [{ name, url }, ...]   (from GEPHI.list())
//   GET /api/file/:name   -> raw .gexf file body, Content-Type: application/xml
//
// No write/upload route is exposed here on purpose — pushing files into R2 is done
// out-of-band via `wrangler r2 object put` or the dashboard (see BUILD-BRIEF.md).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/index") {
      const listed = await env.GEPHI.list();
      const files = listed.objects
        .filter((o) => o.key.toLowerCase().endsWith(".gexf"))
        .map((o) => ({ name: o.key, url: `/api/file/${encodeURIComponent(o.key)}` }));
      return Response.json(files, { headers: CORS_HEADERS });
    }

    const fileMatch = url.pathname.match(/^\/api\/file\/(.+)$/);
    if (fileMatch) {
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
