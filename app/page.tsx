import { formFields, notInApp } from '@/engine/src/options.mjs';
import { BROWSER_NAMES, OS_NAMES } from '@/engine/src/agents.mjs';

import Auditor from './auditor';

// The controls are not hard-coded. `formFields()` is the engine's own table of
// every flag and whether a window should reach it — the authors wrote it so a
// client could build its own controls instead of drifting a second copy. Adding
// a flag upstream adds the control here.
//
// Every gate is open because this app is the person running it: see the comment
// in app/api/engine/[...path]/route.ts.
export default function Home() {
  const fields = formFields(() => true);
  const missing = notInApp();

  return (
    <main className="mx-auto max-w-4xl px-5 py-12 sm:py-20">
      <header className="mb-10">
        <h1 className="t-display">
          seo<span className="text-brand">.</span>auditor
        </h1>
        <p className="t-lead mt-3 max-w-xl text-ink/60">
          Crawls a site&rsquo;s sitemap and checks every page — metadata, structured data, links,
          images, redirects and site-wide config. It will not tell you how you rank.
        </p>
      </header>

      <Auditor fields={fields} agents={{ browsers: BROWSER_NAMES, systems: OS_NAMES }} />

      <details className="card mt-12 p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink/55 transition-colors duration-150 ease-out hover:text-ink">
          What this window does not reach ({missing.length})
        </summary>
        <p className="mt-3 text-xs text-ink/50">
          Straight from the engine&rsquo;s own table. A missing control reads exactly like a
          passing one, so each says why.
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

      <footer className="mt-10 text-xs leading-relaxed text-ink/40">
        Engine vendored from{' '}
        <a
          href="https://github.com/nurkamol/seo-audit"
          className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-brand"
        >
          nurkamol/seo-audit
        </a>{' '}
        — see engine/UPSTREAM.txt. Runs are kept on this machine; list them with{' '}
        <code className="font-mono">seo-audit --reports</code>.
      </footer>
    </main>
  );
}
