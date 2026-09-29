# seo-auditor

A Next.js front end for [nurkamol/seo-audit](https://github.com/nurkamol/seo-audit).

```bash
npm run dev            # http://localhost:3000
npm start & npm run check   # the one runnable check (SITE=… BASE=… to point it elsewhere)
```

## How it fits together

The engine is vendored at `engine/` (see `engine/UPSTREAM.txt` for the commit and
our local patches). It is not re-implemented anywhere:

- **`lib/engine.ts`** — `engine/worker/index.mjs` exports
  `handle(Request, env) => Response`; this is the only caller, and only for
  `preview`, `stream` and `render`. Nothing else of the worker is served.
- **`lib/audits.ts`** — crawls are jobs: `POST /api/audits` queues one, the
  server runs a few at a time, and the browser follows
  `/api/audits/<id>/events`. The report is kept for a week, so a reload
  resumes and exports render the stored copy.
- **`lib/ssrf.ts`** — every fetch a crawl makes is refused if it resolves to
  a private, loopback or link-local address.
- **`app/page.tsx`** — draws the form from `formFields()`, the engine's own
  table of every flag. The controls are not hard-coded, so a flag added
  upstream becomes a control here. `notInApp()` renders the list of what this
  window deliberately does not reach, with the reason for each.
- **`app/auditor.tsx`** — the form, the preview, and the `EventSource` onto
  the queued crawl.
- **`app/report.tsx`** — draws the report from the payload, and asks
  `/api/audits/<id>/export` for every saved file. It formats nothing itself, so a report saved
  here and one saved by the CLI are the same document.
- **`lib/fixer.ts`, `lib/fixes.ts`, `lib/github-write.ts`** — "Fix with AI" in the Repository
  card: a model on any OpenAI-compatible endpoint (`AI_API_URL`, `AI_API_KEY`, `AI_MODEL`) reads
  the linked repository, stages changes you review as a diff, and they become a pull request on a
  new branch. See PLAN.md, Phase A.

Because it runs under Node rather than on Cloudflare, the TLS checks are real.

## If you deploy this

No sign-in to audit; continuing with GitHub (only to link a repository) sets
a session cookie in that browser. PageSpeed, Search Console and crt.sh are off
unless `ALLOW_PSI`, `ALLOW_SEARCH_CONSOLE`, `ALLOW_HOSTS` are set — they spend
the operator's quota. Run it as one long-lived Node process with a disk; see
PLAN.md, Phase 0.5, for every setting.

Multi-site portfolio runs (`seo-audit a.com b.com`) are CLI-only here — the
crawl queue takes one URL.
