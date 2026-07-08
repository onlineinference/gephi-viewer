# Build brief — "Drop a Gephi file, get an interactive graph" (Cloudflare)

Paste this into a new Claude Cowork or Cursor session as the task. It's self-contained.

---

## Objective

A Cloudflare-hosted location where I can **drop Gephi export files (`.gexf`)** and the site **re-creates the
graph as an interactive web visualization** — preserving Gephi's node positions, colors, sizes, and labels
where the export includes them, and auto-laying-out with ForceAtlas2 when it doesn't.

A working single-file viewer already exists: **`gexf-viewer.html`** (ship it as the Pages `index.html`). Your
job is to host it on Cloudflare and wire up the "drop files" storage + listing.

## Stack (and why)

- **Viewer:** `graphology` + `graphology-gexf` (parse `.gexf`) + `sigma.js` (WebGL render) — the browser side
  of the Gephi ecosystem, so it re-creates Gephi output faithfully. Already built in `gexf-viewer.html`.
- **Hosting:** **Cloudflare Pages** for the static viewer.
- **Storage:** **Cloudflare R2** bucket for the dropped `.gexf` files.
- **Glue:** a small **Cloudflare Worker** (or Pages Function) that (a) lists the bucket's files as JSON and
  (b) serves a file by name, both with permissive read CORS so the viewer can fetch them.

## Repo layout

```
/public/index.html         # = gexf-viewer.html (the viewer)
/worker/                   # Worker or Pages Functions
  index.js                 # GET /api/index -> [{name,url}], GET /api/file/:name -> gexf text
wrangler.toml              # Pages + R2 binding
```

## Build steps

1. **R2 bucket:** `wrangler r2 bucket create gephi-files`.
2. **Worker/Functions API**, bound to the bucket (`[[r2_buckets]] binding = "GEPHI"`), exposing:
   - `GET /api/index` → JSON array `[{ "name": "graph.gexf", "url": "/api/file/graph.gexf" }, …]` from `GEPHI.list()`.
   - `GET /api/file/:name` → the object body with `Content-Type: application/xml` and
     `Access-Control-Allow-Origin: *` (read-only).
   - Do **not** expose any public write/upload route.
3. **Pages project** serving `/public` (the viewer). The viewer already supports:
   - drag-and-drop of a local `.gexf`,
   - `?gexf=<url>` to load one file,
   - `?index=<url>` to populate a file dropdown from the JSON index.
   So deploy the viewer and open it as `…/index.html?index=/api/index`.
4. **Deploy:** `wrangler pages deploy public` (viewer) and deploy the Worker; put them on the same domain (or
   enable CORS as above) so `/api/*` is reachable from the viewer.

## How I "drop" files (pick one)

- Fastest: `wrangler r2 object put gephi-files/<name>.gexf --file ./<name>.gexf`.
- Dashboard: Cloudflare → R2 → `gephi-files` → Upload.
- Stretch goal (optional): a tiny upload page **behind Cloudflare Access** (so only I can write), POSTing to a
  Worker route that calls `GEPHI.put()`. Keep uploads authenticated — never a public write endpoint.

## Security / guardrails

- Reads can be public; **writes must be private** (wrangler/dashboard, or an Access-gated upload).
- If the graphs are sensitive, put **Cloudflare Access** in front of the whole Pages site too.
- Pin the CDN library versions in `index.html` (see note below) so a library update can't break rendering.

## Acceptance criteria

- Visiting the Pages URL shows the viewer; the dropdown lists every `.gexf` in R2.
- Selecting a file (or `?gexf=<url>`) renders the graph with Gephi's colors/positions/sizes when present.
- Dragging a local `.gexf` onto the page renders it without any upload.
- A `.gexf` with no layout coords still renders (ForceAtlas2 fallback).
- Bad/non-GEXF input shows a friendly error, not a blank page.

## Notes for the viewer (`gexf-viewer.html`)

- It loads `graphology`, `graphology-gexf`, `graphology-layout-forceatlas2`, and `sigma@3` via an ESM import
  map from jsDelivr. **Confirm the pinned versions resolve** at build time (jsDelivr `+esm`); bump if needed.
- `graphology-gexf` reads Gephi's `viz:position` → `x/y`, `viz:color` → `color`, `viz:size` → `size`, and
  `label`. Those flow straight into sigma, which is what makes it a faithful re-creation.
- Everything is client-side — the `.gexf` is parsed in the browser; the Worker only stores/serves the file.
