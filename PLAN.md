# Plan: from report to pull request

The product loop we are building:

```
scan a site → connect its repo → pick findings → we open a pull request that fixes them → re-scan the preview → score change on the PR
```

The scan is done. The repo connection works but is read-only, uses an OAuth app with the
`repo` scope (full access to every repo the user owns), and only links a repo to a site.

Phases, in order. Each one ships on its own and is useful without the next.

| Phase | What | Needs AI | Needs infra |
|---|---|---|---|
| **0** | GitHub App, connect flow like Vercel's | no | no |
| **A** | "Open pull request" for missing robots.txt / sitemap.xml / llms.txt | no | no |
| **B** | AI fixes for page-level findings, over the GitHub API | yes | no |
| **C** | Sandboxed coding agent + preview re-scan | yes | worker + sandbox |

---

## Phase 0 — GitHub App, the Vercel way

### What Vercel does (the target)

1. **Continue with GitHub** signs the user in through the GitHub App (a user-to-server token),
   not an OAuth app with a scope.
2. If the app is not installed anywhere the user can see, **Install** opens
   `github.com/apps/<slug>/installations/new`. The user picks an account or org, then
   **All repositories** or **Only select repositories**. That choice *is* the permission
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
  `smee.io` channel, or leave it inactive until Phase C (see below).
- **Repository permissions.** Ask now for everything A–C needs, because every permission
  added later makes each installation re-approve:
  - Metadata: read (mandatory)
  - Contents: **read & write** (read trees, push fix branches)
  - Pull requests: **read & write** (open PRs, comment the score change)
  - Commit statuses: read, Deployments: read (find the preview URL in Phase C)
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

| Token | How we get it | Lives | Used for |
|---|---|---|---|
| **User token** (`ghu_…`) | code → `POST /login/oauth/access_token` | 8 h, refresh token 6 months | Who is this, and which installations and repos can they see? (`/user`, `/user/installations`, `/user/installations/{id}/repositories`) |
| **Installation token** (`ghs_…`) | app JWT → `POST /app/installations/{id}/access_tokens` | 1 h, cached in memory until 5 min before expiry | Everything done *to* a repo: look, write, PR |

The **app JWT** is RS256, signed with the private key using `node:crypto` (`createSign`),
with `iss` = the client ID, `iat` = now − 60 s and `exp` = now + 9 min. No dependency needed.

**Security rule:** the browser never supplies an installation ID. Linking reads the repo with the
*user's* token, which only reaches repos that person can see *and* the app is installed on. Then
the server asks GitHub as the app (`GET /repos/{o}/{r}/installation`) which installation covers it.

### Code changes

**New `lib/github-app.ts`**
- `appJwt()`: signs the JWT.
- `installationToken(installationId, { repositories?, permissions? })`: mints a token and
  caches it. Scoping to one repo and fewer permissions is used by Phase C.
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
- `repos` gets `installation_id INTEGER`. A link now remembers *which installation grants
  access*, so later work (PRs, background jobs) can mint a token without the user present.
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

| Route | Change |
|---|---|
| `GET connect` | Redirect to `github.com/login/oauth/authorize?client_id=…&state=…`. GitHub Apps take no `scope`. The same CSRF state cookie as today. |
| `GET connect?install` | Redirect to `github.com/apps/<slug>/installations/new?state=…`. Used for "Install", "Add GitHub account" and "Adjust permissions". |
| `GET callback` | Handles both returns: `code` (sign-in, and install when user auth during install is on) and `installation_id` + `setup_action=install\|update` (setup redirect). Exchanges the code, saves the account, and posts `{ type: 'github-connect', ok, login }` to the opener as today. |
| `GET repos?installation=<id>` | `{ installations, installation, repos }`: the account switcher and one account's repos (the first if none is asked for) in one request. |
| `POST /api/git` | `look()` as the user (the permission check), then `installationFor()` and save it on the link. Reads after that use the installation token. |
| `DELETE connect` | Forget the account. Also `DELETE /applications/{client_id}/grant` so it disappears from the user's GitHub authorized apps. |
| `POST webhook` (new) | Verify the signature. On `installation.deleted` / `suspend`, null `installation_id` on affected links. On `installation_repositories.removed`, the same for those repos. Everything else is `200` and ignored until Phase C. |

Webhooks can wait. Without them, a removed installation shows up as a 404 when minting a
token, and the link falls back to "reconnect" with that reason. Build the webhook route in
Phase 0 only if `smee.io` setup is painless. Otherwise do it in Phase C, which needs it anyway.

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
  *or* when the popup closes, because an "adjust" on GitHub may never redirect back.
- Linked state is unchanged, plus an `installation` fallback. If the link has no installation
  (old link, or app removed), show "Reconnect this repository" instead of silently reading as
  anonymous.
- The caption stays "Read-only" until Phase A ships.

**Also delete:** the old OAuth-only code in `callback/route.ts` and `listRepos` / `/user/repos`
in `lib/github.ts`. Nothing else should keep using the old `repo` scope.

### Optional: sign-in with the same app

`users` holds one row (`LOCAL_USER`). The GitHub user token already identifies the person, so
"Sign in with GitHub" is `users.github_id` plus a session cookie. It is needed before this is
hosted for anyone but you, but not for Phases A–C locally. Track it separately.

### Done when

- A fresh browser can go: Continue with GitHub → install on selected repos → pick account →
  Import → the file check shows, with a private repo too.
- Adjust permissions → add a repo → it appears without reloading the page.
- Uninstalling the app on GitHub turns the link into "Reconnect", not a fake "missing".
- `npm run test:app`, `npx tsc --noEmit` and `npm run lint` are clean.

---

## Phase A — "Open pull request" for the missing files

No AI. Uses what the engine already writes: `report.sitemap` (`engine/src/sitemap.mjs`) and
`report.llms` (`engine/src/llms.mjs`). Both already refuse to write from an incomplete crawl.
robots.txt needs a small generator.

### Where each file goes

Decide from the repo tree (already fetched by `look()`) and `package.json`:

| Framework (detected by) | robots | sitemap | llms.txt |
|---|---|---|---|
| Next.js app router (`next` + `app/`) | `app/robots.ts` | `public/sitemap.xml`* | `public/llms.txt` |
| Next.js pages router / Vite / Astro / Nuxt / Remix / CRA | `public/…` | `public/…` | `public/…` |
| Hugo (`config.toml` / `hugo.toml`) | `static/…` | `static/…` | `static/…` |
| Jekyll (`_config.yml`), Gatsby (`static/`), plain HTML | root / `static/` | same | same |
| Unknown | don't guess: say "couldn't tell where this site serves files from" |

\* A static sitemap from a crawl goes stale. The PR body says so, and a dynamic `app/sitemap.ts`
is a Phase B/C fix.

This is a pure function, `placement(paths, packageJson) → { robots, sitemap, llms } | null`, in
`lib/placement.ts`, with one test covering the table above.

**robots.txt content:** `User-agent: *` + `Allow: /` + `Sitemap: <origin>/sitemap.xml`. Only
offered when the crawl found no robots.txt. Never overwrite an existing one.

### Writing (new `lib/github-write.ts`, so `lib/github.ts` stays read-only)

`openPullRequest({ token, owner, name, base, files: [{ path, content }], title, body })`:

1. `GET /repos/{o}/{r}/git/ref/heads/{base}` → base commit SHA.
2. `POST /repos/{o}/{r}/git/trees` with `base_tree` and inline `content`, which skips
   separate blobs.
3. `POST /repos/{o}/{r}/git/commits` with the parent set to the base SHA.
4. `POST /repos/{o}/{r}/git/refs` for `refs/heads/seo-auditor/<yyyy-mm-dd>-<short>`. On
   `422 already exists`, add a suffix.
5. `POST /repos/{o}/{r}/pulls`, draft = false, maintainer_can_modify = true.

Each step's failure maps to a human reason, the way `look()` does: branch protection, the app
lacking access to that repo, a stale base. Refuse if any target path already exists in the
tree, because this phase only adds files.

### Storage

New `pull_requests` table: `id, user_id, repo_id, number, url, branch, kind ('files'|'ai'|'agent'),
findings JSON, state ('open'|'merged'|'closed'), score_before, created_at`. Used for "a PR is
already open for this" and for Phase C's score comment.

### UI

- In the linked Repository card, missing files get a checkbox, pre-ticked.
- **Preview**: a read-only view of each file's path and content. The user sees exactly what
  will be committed.
- **Open pull request** (primary button) → a spinner → "Pull request #12 opened →" link.
- If an open PR already exists for these files, show its link instead of the button.
- Caption: "Read-only until you ask for a pull request. We never push to your default branch."

### PR body

A template built from the report: what was missing, the finding each file fixes, the score
before, where the file was placed and why, and a stale-sitemap note if relevant. It ends with
the audit link.

### Done when

Against a throwaway repo: missing files → one PR with correct paths per framework, the bot as
author, nothing on the default branch. The second click shows the existing PR.

---

## Phase B — AI fixes for page-level findings

For findings fixable in one or a few template files, without a build: title, meta description,
canonical, Open Graph / Twitter tags, `lang`, image `alt`, JSON-LD, heading structure, and a
dynamic sitemap/robots route.

### Which findings

An allowlist of check IDs in `lib/fixable.ts` (checks come from `engine/src/checks.mjs`), each
tagged `files` (A), `ai` (B) or `agent` (C). The UI only offers AI fixes for `ai` checks. Each
finding already has `fix`, evidence and pages. That, not the whole report, is the prompt.

### The loop (new `lib/fixer.ts`)

Claude Messages API with tool use. Raw `fetch` to `/v1/messages` to match the zero-dependency
style; the `@anthropic-ai/sdk` tool runner is the alternative if the loop grows. Model:
`claude-sonnet-5` by default. Set `ANTHROPIC_API_KEY` in env.

Tools we implement (all against the GitHub API with the installation token, and nothing
executes):

| Tool | Does |
|---|---|
| `list_files(prefix)` | From the tree `look()` already fetched |
| `read_file(path)` | `GET /repos/{o}/{r}/contents/{path}`. Capped at 100 KB |
| `edit_file(path, old, new)` | Exact-string replace, **staged in memory**. Fails if `old` is not unique |
| `create_file(path, content)` | Staged. Refuses paths that exist |
| `done(summary, per_finding)` | Ends the loop; per finding: fixed / skipped + why |

System prompt: the framework (from Phase A's detection), a URL → source file hint (e.g. Next's
`/blog/x` → `app/blog/[slug]/page.tsx`), the selected findings, and the rules: minimal
diffs, match the code style, never invent content (descriptions come from the page's own text,
as `llms.mjs` does), skip rather than guess.

Limits: 25 turns, a token budget per run, a denylist of paths (`.github/`, lockfiles, `.env*`),
and at most 20 files changed.

### Flow

1. The user ticks AI-fixable findings → **Fix with AI**.
2. The run is a row in a `jobs` table (`id, user_id, repo_id, kind, status, input JSON,
   output JSON, log, tokens_in, tokens_out, created_at, finished_at`). The UI polls it.
   Run it in-process after responding; check `after()` in the local Next docs first. It is
   fine for self-hosted `next start`; serverless time limits are why Phase C moves it to a worker.
3. The result is a **diff view** per file, plus the model's per-finding summary.
4. The user approves → Phase A's `openPullRequest()` with the staged files (it now also accepts
   modifications: `content` for existing paths with base_tree). The PR body lists fixed and
   skipped findings with reasons.

### Quality

`evals/` holds three small fixture repos (Next app router, Astro, plain HTML) with seeded SEO
faults and expected outcomes. `npm run eval` runs the fixer against them and diffs the results.
Run it before any prompt or model change.

### Done when

On the Next fixture: missing meta description + missing canonical → one PR editing the right
`layout.tsx` / `page.tsx`, with the content taken from the page, and cost logged in `jobs`.

---

## Phase C — Sandboxed coding agent + preview re-scan

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
   prompt as B plus the findings. Tools: Read, Edit, Write, Glob, Grep, Bash (the Bash
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

Phase B/C PRs get the re-scan too. It is the same webhook, keyed by the branch in
`pull_requests`.

### Done when

On the Next fixture deployed to Vercel: an agent PR that builds, a preview re-scan comment
with the score change, and a production re-scan on merge.

---

## Before this is hosted for other people (not in any phase above)

- Sign-in (GitHub via the same app) and real `users` rows instead of `LOCAL_USER`.
- Encrypt tokens at rest (the key in env, AES-GCM with `node:crypto`).
- Per-user rate limits and spend caps on B/C, then billing.
- Audit log of every write we make to a user's repo.
