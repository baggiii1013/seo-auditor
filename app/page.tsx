import { formFields, notInApp } from "@/engine/src/options.mjs";
import { BROWSER_NAMES, OS_NAMES } from "@/engine/src/agents.mjs";
import { connection } from "next/server";

import { gitState } from "@/lib/git-state";

import Auditor from "./auditor";

// The controls are not hard-coded. `formFields()` is the engine's own table of
// every flag and whether a window should reach it — the authors wrote it so a
// client could build its own controls instead of drifting a second copy. Adding
// a flag upstream adds the control here.
//
// Every gate is open because this app is the person running it: see the comment
// in app/api/engine/[...path]/route.ts.
export default async function Home() {
  // Read at request time, not frozen into the build: who is connected to GitHub
  // and which sites have a repository, so the report never has to ask.
  await connection();
  const git = gitState();
  const fields = formFields(() => true);
  const missing = notInApp();

  return (
    // `.shell` is 4xl until a report is on the page, then it is the display —
    // see globals.css.
    <main className="shell px-5 py-12 sm:py-20">
      <header className="mb-10">
        <h1 className="t-display text-page-ink">
          seo<span className="text-brand">.</span>auditor
        </h1>
        <p className="t-lead mt-3 max-w-xl text-page-ink/75">
          Crawls a site&rsquo;s sitemap and checks every page — metadata, structured data, links,
          images, redirects and site-wide config. Then the same pass asks what an answer engine
          gets: whether ChatGPT, Claude and Perplexity are let in, and whether there is anything
          quotable once they are.
        </p>
      </header>

      <Auditor fields={fields} agents={{ browsers: BROWSER_NAMES, systems: OS_NAMES }} git={git} />

      <details className="card mt-12 max-w-4xl p-5">
        {/* Stays at the measure it was written for even when the shell widens:
            this is a two-column list of prose, not a chart. */}
        <summary className="cursor-pointer text-sm font-medium text-ink/55 transition-colors duration-150 ease-out hover:text-ink">
          What this window does not reach ({missing.length})
        </summary>
        <p className="mt-3 text-xs text-ink/50">
          Straight from the engine&rsquo;s own table. A missing control reads exactly like a passing
          one, so each says why.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {missing.map(({ flag, reason }) => (
            <li key={flag} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <code className="font-mono text-xs text-ink/75">{flag}</code>
              <span className="text-ink/55">{reason}</span>
            </li>
          ))}
        </ul>
      </details>

      <footer className="mt-10 text-xs leading-relaxed text-page-ink/70">
        — see engine/UPSTREAM.txt. Runs are kept on this machine; list them with{" "}
        <code className="font-mono">seo-audit --reports</code>.
      </footer>
    </main>
  );
}
