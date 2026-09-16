# seo-auditor

A Next.js front end for [nurkamol/seo-audit](https://github.com/nurkamol/seo-audit).

```bash
npm run dev            # http://localhost:3000
npm start & npm run check   # the one runnable check (SITE=… BASE=… to point it elsewhere)
```

## How it fits together

The engine is vendored at `engine/` (see `engine/UPSTREAM.txt` for the commit and
our two local patches). It is not re-implemented anywhere:

- **`app/api/engine/[...path]/route.ts`** — `engine/worker/index.mjs` exports
  `handle(Request, env) => Response`, which is exactly a Next route handler.
  This file strips the `/api/engine` prefix, presents the worker's bearer token
  and hands the request over. That one file is the whole backend, and every
  route the engine has comes with it: `/stream` (SSE), `/run`, `/plan`,
  `/preview`, `/diff`, `/reports`, `/compare`, `/checks`, `/options`,
  `/agents`, `/render`.
- **`app/page.tsx`** — draws the form from `formFields()`, the engine's own
  table of every flag. The controls are not hard-coded, so a flag added
  upstream becomes a control here. `notInApp()` renders the list of what this
  window deliberately does not reach, with the reason for each.
- **`app/auditor.tsx`** — the form, the preview, and the `EventSource` onto
  `/stream?format=json`.
- **`app/report.tsx`** — draws the report from the payload, and asks
  `/render` for every saved file. It formats nothing itself, so a report saved
  here and one saved by the CLI are the same document.

Because it runs under Node rather than on Cloudflare, the TLS checks are real
and finished runs are kept — `seo-audit --reports` lists them.

## If you deploy this

`route.ts` opens every gate (`ALLOW_PSI`, `ALLOW_SEARCH_CONSOLE`,
`ALLOW_HOSTS`) because the person running it locally is the person whose quota,
account and rate limit get spent. Serving strangers means deleting those three
lines first.

Multi-site portfolio runs (`seo-audit a.com b.com`) are CLI-only here — the
`/stream` route takes one URL.
