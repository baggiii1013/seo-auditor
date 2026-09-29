# Plan: from report to pull request

The product loop we are building:

```
scan a site → connect its repo → pick findings → we open a pull request that fixes them → re-scan the preview → score change on the PR
```

The scan is done. The repo connection works but is read-only, uses an OAuth app with the
`repo` scope (full access to every repo the user owns), and only links a repo to a site.

Phases, in order. Each one ships on its own and is useful without the next.

| Phase | What                                                                                    | Needs AI | Needs infra      |
| ----- | --------------------------------------------------------------------------------------- | -------- | ---------------- |
| **0** | GitHub App, connect flow like Vercel's                                                  | no       | no               |
| **A** | AI pull requests: the missing robots.txt / sitemap / llms.txt, then page-level findings | yes      | no               |
| **B** | Sandboxed coding agent + preview re-scan                                                | yes      | worker + sandbox |

---

## Phase 0 — GitHub App, the Vercel way

### What Vercel does (the target)

1. **Continue with GitHub** signs the user in through the GitHub App (a user-to-server token),
   not an OAuth app with a scope.
2. If the app is not installed anywhere the user can see, **Install** opens
   `github.com/apps/<slug>/installations/new`. The user picks an account or org, then
   **All repositories** or **Only select repositories**. That choice _is_ the permission
   boundary.
3. The import screen has an **account switcher** (every installation the user can access:
   personal + orgs) and a searchable repo list for the selected account, with **Import** per row.
4. At the bottom: **Missing a repository? Adjust GitHub App permissions →** reopens the install
   page to add repos or another org. When it closes, the list refreshes.
5. Anything done later on the user's behalf (reading trees, pushing branches, opening PRs) uses
   short-lived **installation tokens** minted by the server, not the user's token. PRs are
   authored by `<app>[bot]`.

### Register the GitHub App (manual, one time)

`github.com/settings/apps/new` (or under an org for the product's own account):

- **Name / slug:** e.g. `seo-auditor` → install URL `github.com/apps/seo-auditor/installations/new`.
- **Callback URL:** `<app>/api/git/callback`.
- **Request user authorization (OAuth) during installation:** ✅. Install and sign-in
  happen in one trip.
- **Expire user authorization tokens:** ✅ (default). We store the refresh token.
- **Setup URL:** leave empty. GitHub greys it out once user authorization during installation
  is on, and sends the install back to the callback URL instead. "Adjust permissions" may not
  redirect back, so the panel refetches when the popup closes (`popup.closed` poll), not only
  on `postMessage`.
- **Enable Device Flow:** ❌. It's for CLIs, and it's a phishing vector we don't need.
- **Webhook:** active, URL `<app>/api/git/webhook`, secret set. Locally, point it at a
  `smee.io` channel, or leave it inactive until Phase B (see below).
- **Repository permissions.** Ask now for everything A–C needs, because every permission
  added later makes each installation re-approve:
  - Metadata: read (mandatory)
  - Contents: **read & write** (read trees, push fix branches)
  - Pull requests: **read & write** (open PRs, comment the score change)
  - Commit statuses: read, Deployments: read (find the preview URL in Phase B)
  - Checks: read (same, for hosts that report previews as check runs)
- **Account permissions:** none needed. Email is optional, and only if sign-in (below) wants it.
- **Subscribe to events:** Installation, Installation repositories, Pull request,
  Deployment status, Check run.
- **Where can it be installed:** Any account.
- Generate a **private key** (PEM) and note the **App ID**, **Client ID**, **Client secret**.

`.env.local`:

```
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=      # PEM, newlines as \n
GITHUB_WEBHOOK_SECRET=
```

`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (the old OAuth app) are removed. `GITHUB_TOKEN`
stays as the no-login fallback for reading public repos.

### Two kinds of token

| Token                            | How we get it                                          | Lives                                           | Used for                                                                                                                               |
| -------------------------------- | ------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **User token** (`ghu_…`)         | code → `POST /login/oauth/access_token`                | 8 h, refresh token 6 months                     | Who is this, and which installations and repos can they see? (`/user`, `/user/installations`, `/user/installations/{id}/repositories`) |
| **Installation token** (`ghs_…`) | app JWT → `POST /app/installations/{id}/access_tokens` | 1 h, cached in memory until 5 min before expiry | Everything done _to_ a repo: look, write, PR                                                                                           |

The **app JWT** is RS256, signed with the private key using `node:crypto` (`createSign`),
with `iss` = the client ID, `iat` = now − 60 s and `exp` = now + 9 min. No dependency needed.

**Security rule:** the browser never supplies an installation ID. Linking reads the repo with the
_user's_ token, which only reaches repos that person can see _and_ the app is installed on. Then
the server asks GitHub as the app (`GET /repos/{o}/{r}/installation`) which installation covers it.

### Code changes

**New `lib/github-app.ts`**

- `appJwt()`: signs the JWT.
- `installationToken(installationId, { repositories?, permissions? })`: mints a token and
  caches it. Scoping to one repo and fewer permissions is used by Phase B.
- `exchangeCode(code)` and `refreshUserToken(refreshToken)`: user tokens.
- `userInstallations(userToken)`: `[{ id, account: { login, type, avatarUrl }, repositorySelection }]`.
- `installationRepos(userToken, installationId)`: replaces `listRepos` (same `RepoChoice`
  shape, paginated with the same 300 cap).
- `verifyWebhook(body, signature)`: HMAC-SHA256 compared with `timingSafeEqual`.
- One test, `lib/github-app.test.ts`: sign a JWT with a key from `generateKeyPairSync` and
  verify it; verify a webhook signature, plus one tampered body that must fail.

**`lib/db.ts`**

- `github_accounts` gets `refresh_token TEXT` and `expires_at TEXT` (`github_id` waits for sign-in).
  Tokens from the old OAuth app are useless with the new app, so on schema bump delete the old
  rows and the user reconnects once.
- `repos` gets `installation_id INTEGER`. A link now remembers _which installation grants
  access_, so later work (PRs, background jobs) can mint a token without the user present.
- Keep the `ponytail:` note about plain-text tokens. Encrypting at rest becomes mandatory
  before this is hosted for other people.

**`lib/git-state.ts`**

- `gitAuth()` returns the user token (refreshed if expired). It gains
  `tokenFor(repo)`: installation token if `repo.installationId`, else user token, else
  `GITHUB_TOKEN`, else anonymous.
- `canConnect` checks the new env vars.
- `GitState` gains `appSlug` so the client can build the install URL.

**Routes (`app/api/git/…`)** — check `node_modules/next/dist/docs/` for route handler
conventions before writing these (see AGENTS.md).

| Route                         | Change                                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET connect`                 | Redirect to `github.com/login/oauth/authorize?client_id=…&state=…`. GitHub Apps take no `scope`. The same CSRF state cookie as today.                                                                                                                                             |
| `GET connect?install`         | Redirect to `github.com/apps/<slug>/installations/new?state=…`. Used for "Install", "Add GitHub account" and "Adjust permissions".                                                                                                                                                |
| `GET callback`                | Handles both returns: `code` (sign-in, and install when user auth during install is on) and `installation_id` + `setup_action=install\|update` (setup redirect). Exchanges the code, saves the account, and posts `{ type: 'github-connect', ok, login }` to the opener as today. |
| `GET repos?installation=<id>` | `{ installations, installation, repos }`: the account switcher and one account's repos (the first if none is asked for) in one request.                                                                                                                                           |
| `POST /api/git`               | `look()` as the user (the permission check), then `installationFor()` and save it on the link. Reads after that use the installation token.                                                                                                                                       |
| `DELETE connect`              | Forget the account. Also `DELETE /applications/{client_id}/grant` so it disappears from the user's GitHub authorized apps.                                                                                                                                                        |
| `POST webhook` (new)          | Verify the signature. On `installation.deleted` / `suspend`, null `installation_id` on affected links. On `installation_repositories.removed`, the same for those repos. Everything else is `200` and ignored until Phase B.                                                      |

Webhooks can wait. Without them, a removed installation shows up as a 404 when minting a
token, and the link falls back to "reconnect" with that reason. Build the webhook route in
Phase 0 only if `smee.io` setup is painless. Otherwise do it in Phase B, which needs it anyway.

**`app/git-panel.tsx`** (same card, new states)

```
┌ REPOSITORY ───────────────────────────────────────────────┐
│ Link the GitHub repository behind this site…  [Continue with GitHub] │   not signed in
├───────────────────────────────────────────────────────────┤
│ No GitHub account has the app installed.       [Install GitHub App]  │   signed in, 0 installs
├───────────────────────────────────────────────────────────┤
│ [◉ baggiii ▾]  [ Search…                        ] [Cancel] │   picker
│  owner/repo-a            Private            [Import]      │
│  owner/repo-b                               [Import]      │
│  Missing a repository? Adjust GitHub App permissions →    │
│  Signed in as baggiii · Sign out                          │
└───────────────────────────────────────────────────────────┘
```

- Account switcher: a native `<select>` (avatar + login), or a Base UI `Menu` since
  `@base-ui/react` is installed. The last item is **+ Add GitHub account** → install popup.
- The popup opener is shared by connect, install and adjust. Popups that come back through the
  callback report via the same `postMessage`. Refetch installations and repos on that message
  _or_ when the popup closes, because an "adjust" on GitHub may never redirect back.
- Linked state is unchanged, plus an `installation` fallback. If the link has no installation
  (old link, or app removed), show "Reconnect this repository" instead of silently reading as
  anonymous.
- The caption stays "Read-only" until Phase A ships.

**Also delete:** the old OAuth-only code in `callback/route.ts` and `listRepos` / `/user/repos`
in `lib/github.ts`. Nothing else should keep using the old `repo` scope.

### Sign-in with the same app — done, see Phase 0.5

Auditing needs no sign-in. Continuing with GitHub creates a `users` row keyed by `github_id`
and a session cookie in that browser; links and tokens are scoped to it.

### Done when

- A fresh browser can go: Continue with GitHub → install on selected repos → pick account →
  Import → the file check shows, with a private repo too.
- Adjust permissions → add a repo → it appears without reloading the page.
- Uninstalling the app on GitHub turns the link into "Reconnect", not a fake "missing".
- `npm run test:app`, `npx tsc --noEmit` and `npm run lint` are clean.

---

## Phase 0.5 — Backend hardening (done)

The app used to proxy every request under `/api/engine/*` straight into the engine's worker,
presenting the worker's password on the caller's behalf. Before anything writes to repos:

| Problem                                                                                                   | Fix                                                                                                                                                                                   | Where                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Catch-all proxy exposed every worker route (report library, compare, export) to anyone                    | Five narrow routes; nothing else of the worker is reachable                                                                                                                           | `app/api/preview`, `app/api/audits/**`, `lib/engine.ts` |
| PageSpeed, Search Console and crt.sh spent the operator's quota for any visitor                           | Off unless `ALLOW_PSI` / `ALLOW_SEARCH_CONSOLE` / `ALLOW_HOSTS` = 1; the form hides what is off                                                                                       | `lib/engine.ts`, `app/page.tsx`                         |
| A crawl could fetch internal addresses (cloud metadata, localhost, LAN)                                   | Every engine fetch asks `refuseInternal()` first; the form's URL is refused up front                                                                                                  | `engine/src/http.mjs` (hook), `lib/ssrf.ts`             |
| One shared `LOCAL_USER`: whoever connected GitHub did so for every visitor                                | Session cookie (`sid`, HttpOnly, SameSite=Lax, Secure in prod, 30 days; only its SHA-256 is stored) created by the GitHub callback; links and tokens per user                         | `lib/db.ts`, `lib/git-state.ts`, `app/api/git/**`       |
| A crawl lived inside one request: dropped with the browser, unbounded concurrency, report only in the tab | Crawls are jobs: queued, `AUDIT_CONCURRENCY` at a time (default 2), 2 per address, report stored for 7 days; the browser follows `/api/audits/<id>/events` and resumes after a reload | `lib/audits.ts`                                         |
| Exports rendered any JSON a caller posted                                                                 | Exports render the stored report by id                                                                                                                                                | `app/api/audits/[id]/export`                            |
| No request limits                                                                                         | Per-address: 10 audits, 30 previews, 60 exports an hour                                                                                                                               | `lib/limit.ts`                                          |

Known ceilings, each marked `ponytail:` in the code:

- The queue, live logs and rate-limit counts are one process's memory. More than one process
  means moving them to the store (or Redis).
- A running crawl cannot be cancelled — the engine takes no abort signal. Stop only removes a
  queued one.
- DNS rebinding can slip past the address check (checked, then resolved again by `fetch`).
- `X-Forwarded-For` is trusted: run behind a proxy that overwrites it.

### Hosting

A long-lived Node process with a persistent disk — a VPS, Fly.io or Railway with a volume, not
serverless. Crawls run for minutes in the background, and SQLite plus the job queue live on
that one machine.

```bash
npm ci && npm run build
SEO_AUDIT_HOME=/data NODE_ENV=production npm start   # behind a TLS proxy
```

| Env                                                | Default                    |                                                                           |
| -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------- |
| `SEO_AUDIT_HOME`                                   | `~/.local/share/seo-audit` | Where `app.db` lives — put it on the volume                               |
| `AUDIT_CONCURRENCY`                                | 2                          | Crawls at once, for the whole server                                      |
| `MAX_PAGES` / `MAX_CONCURRENCY`                    | 150 / 12                   | Ceilings on what the form may ask for                                     |
| `ALLOW_PSI`, `ALLOW_SEARCH_CONSOLE`, `ALLOW_HOSTS` | off                        | Operator's own quotas; local use only                                     |
| `ALLOW_PRIVATE_HOSTS`                              | off                        | Audit sites on your own network; never on a public deployment             |
| `GITHUB_APP_*`                                     | —                          | See Phase 0; the callback URL becomes `https://<domain>/api/git/callback` |
| `AI_API_URL`, `AI_API_KEY`, `AI_MODEL`             | —                          | Any OpenAI-compatible endpoint; see Phase A. Unset hides "Fix with AI"    |
| `AI_TOKEN_BUDGET`                                  | no cap                     | Tokens (in + out) one fix may spend before it is stopped                  |
| `AI_MAX_TURNS`                                     | no cap                     | Round trips to the model one fix may take before it is stopped            |

---

## Phase A — AI pull requests (built; evals and a real-model run pending)

One loop for every fix that doesn't need the site's build: the missing robots.txt, sitemap and
llms.txt first, then page-level findings (title, meta description, canonical, Open Graph /
Twitter tags, `lang`, image `alt`, JSON-LD, heading structure).

### Why the missing files go through the model, not a template

They are the easiest job for the loop, because it only creates files and never edits them. They
still need judgment a template doesn't have:

| File       | A template writes                               | The model, reading the repo, writes                                                                                                                 |
| ---------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| robots.txt | `Allow: /` for everything                       | Disallows what the routes show shouldn't be crawled (`/api`, `/admin`, drafts, search pages), in the framework's own route (`app/robots.ts`) if any |
| sitemap    | A static snapshot of one crawl, stale next post | A dynamic `app/sitemap.ts` (or the framework's plugin) built from the routes or content source; the crawl's URL list checks nothing is missed       |
| llms.txt   | The engine's draft, as is                       | The draft as raw material: sections that match what the site is, pages that don't belong dropped                                                    |

Placement is not a hard-coded framework table either: the model reads `package.json` and the tree.
If it can't tell where the site serves files from, it skips the file and says so.

The engine's `report.sitemap` (`engine/src/sitemap.mjs`) and `report.llms`
(`engine/src/llms.mjs`) go into the prompt as the facts: which URLs exist and what each page
says about itself. Both refuse to draft from an incomplete crawl. The model then gets no draft,
and must skip rather than invent.

### Which findings

`FIXABLE` in `lib/fixable.ts`: the check ids a model may fix from source, each `file` (the three
missing documents, pre-ticked) or `page` (a tag in a template). Everything else waits for Phase B.
The prompt is the picked checks' title, the engine's detail and their pages, not the whole report.

Audits now always ask the engine for its sitemap, llms.txt and schema drafts (`lib/audits.ts`),
so every stored report carries them. Before, the app never asked and the drafts never existed.

### The loop (`lib/fixer.ts`)

Any OpenAI-compatible `/chat/completions` endpoint with tool calling: `AI_API_URL` (the base, e.g.
`https://openrouter.ai/api/v1`, or the full `/chat/completions` URL), `AI_MODEL`, and `AI_API_KEY`
unless the endpoint is local. Raw `fetch`, two retries on 429/5xx.

| Tool                         | Does                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `list_files(prefix)`         | The tree at the pinned commit, plus staged files                                 |
| `read_file(path)`            | The staged version if any, else `contents/{path}?ref=<sha>`. Refused over 100 KB |
| `edit_file(path, old, new)`  | Exact-string replace, **staged in memory**. Fails unless `old` appears once      |
| `create_file(path, content)` | Staged. Refuses paths that exist                                                 |
| `done(summary, findings)`    | Ends the run; per finding: fixed / skipped + why                                 |

Rules in the system prompt: the framework's own mechanism over a static file, robots disallows
only what the routes show, sitemap generated from the source where possible, llms.txt from the
engine's draft, never invent content, minimal diffs, skip rather than guess. The crawl data sits
inside `<crawl>` and is declared data, not instructions.

Enforced in code, not asked of the model: `AI_MAX_TURNS` and `AI_TOKEN_BUDGET` if set, at most 20 files, no
writes to `.github/`, `.env*`, lockfiles or paths that climb. A finding the model never reports
on is skipped, and a run that changed no file fixed nothing, whatever it says.

### Writing (`lib/github-write.ts`, so `lib/github.ts` stays read-only)

`openPullRequest()` commits onto the SHA the model read (so a moved base shows as a conflict in
the PR rather than silently overwriting it): one tree with inline content, one commit, a ref
`seo-auditor/<yyyy-mm-dd>-<job id>`, then the pull request. The branch is the job's own, so a
retry force-moves it and finds the PR already open instead of opening a second. Failures map to
what to do: missing Contents / Pull requests write permission, the app losing the repo, an empty
repo.

### Storage

One `jobs` table: the input checks, the model's output (base SHA, summary, per-finding verdicts,
each file's before and after), the log, tokens in and out, and the pull request (`number, url,
branch, state`). A partial unique index allows one running fix per user. Open PRs are re-checked
against GitHub when the panel loads, so a merged or closed one stops covering its findings.

### Flow (`app/fix-panel.tsx`, inside the linked Repository card)

1. Pick: fixable findings with checkboxes; the missing files are pre-ticked; a finding already
   in an open PR shows its link instead. **Fix N with AI** (rate limit: 10 an hour per address).
2. Run: `POST /api/fixes` answers with the job and the run carries on in-process; the panel
   polls `/api/fixes/<id>` and shows the log. A reload picks it up again. **Stop**
   (`DELETE /api/fixes/<id>`) cuts the model request in flight; nothing staged goes anywhere.
3. Done: when the model calls `done`, the run opens the pull request itself (still `running`
   until it is open) and the panel shows it with the summary, each finding fixed or skipped with
   why, and the same diff per file. Review and merge happen on GitHub. A pull request that fails
   to open keeps the changes; **Try again** is `POST /api/fixes/<id>/pull`. A run that changed no
   file opens nothing.

The PR body lists fixed and skipped findings with reasons, the files, the score of the audit it
came from, and says it was written by a model and never built.

### Quality

Not built yet: `evals/` with three fixture repos (Next app router, Astro, plain HTML) with seeded
faults, one with no robots/sitemap/llms and an `/api` route that must end up disallowed, and
`npm run eval` to run the fixer against them. Run it before any prompt or model change.

Tested without a model: the tools and their refusals (`lib/fixer.test.ts`), the PR write path
against a stubbed GitHub (`lib/github-write.test.ts`), the diff (`lib/diff.test.ts`), and one
running fix per user (`lib/db.test.ts`). End to end against a scripted fake model, a real audit
and real GitHub reads: pick → run → review → refusals.

### Done when

On the Next fixture:

- Missing files → one PR with `app/robots.ts` (`/api` disallowed), `app/sitemap.ts` and
  `public/llms.txt` whose text comes from the pages. The bot is the author, and nothing lands on
  the default branch. The second click shows the existing PR.
- Missing meta description + canonical → one PR editing the right `layout.tsx` / `page.tsx`.
- Cost is logged in `jobs` (`tokens_in`, `tokens_out`).

---

## Phase B — Sandboxed coding agent + preview re-scan

For fixes that touch many files or must be proven by a build: a dynamic sitemap from a CMS,
image optimisation, broken internal links across templates, `hreflang`, redirects config,
performance findings from PSI.

### Worker

A separate process, `node worker.mjs`, next to `next start`. It polls `jobs` where
`kind = 'agent'` (SQLite WAL handles one host fine).

`ponytail:` SQLite as a queue. Swap for a real queue when there's more than one host.

### Sandbox

One container per job. Options: **Docker locally** (gVisor runtime if available), then **E2B**
or **Vercel Sandbox** when hosted. Limits: 2 CPU, 4 GB, 15 min, no host mounts.
Network egress allowlist: `github.com`, the package registry, and an Anthropic **proxy**
we run, so the API key is never inside the sandbox.

### Run

1. Mint an installation token **scoped to this one repo** with `contents: write` only
   (`installationToken(id, { repositories: [name], permissions: { contents: 'write' } })`).
2. `git clone https://x-access-token:<token>@github.com/o/r`, then detect the package manager
   and install.
3. Run the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, `query()`) with the same
   prompt as A plus the findings. Tools: Read, Edit, Write, Glob, Grep, Bash (the Bash
   allowlist is the package manager's install / build / lint / test), with `maxTurns`.
4. **We** run build + lint after the agent finishes. We don't trust its claim. Failure means
   no PR, and the log is shown.
5. Diff limits (file count, no lockfile churn unless deps changed, the path denylist from B).
   Then commit as the bot, push the branch, and open the PR with `openPullRequest` from outside
   the sandbox using the pushed branch.
6. Stream the log to the UI (poll the `jobs.log` tail).

**Prompt injection:** repo content can tell the agent to do things. The defense is
structural: a one-repo, contents-only token that expires in an hour, no other secrets inside,
egress allowlist, and a human-approved PR as the only output.

### Preview re-scan (the closed loop)

- Webhooks: `deployment_status` (state `success`, environment containing "Preview") or
  `check_run` from Vercel/Netlify → take the `target_url`.
- Run the engine audit on the preview URL with the same options as the original scan.
- Comment on the PR: score before → after, and which of the targeted findings now pass or
  still fail. Update the same comment on later pushes.
- `pull_request.closed` with `merged` → re-scan production, and mark the findings resolved in
  the site's history.

Phase A and B PRs get the re-scan too. It is the same webhook, keyed by the branch stored on the
job's `pr`.

### Done when

On the Next fixture deployed to Vercel: an agent PR that builds, a preview re-scan comment
with the score change, and a production re-scan on merge.

---

## Before this is hosted for other people (not in any phase above)

- Encrypt tokens at rest (the key in env, AES-GCM with `node:crypto`).
- Per-user rate limits and spend caps on B/C, then billing.
- Audit log of every write we make to a user's repo.
