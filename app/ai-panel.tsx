'use client';

// The answer-engine report.
//
// The numbers are `score.ai`, computed once in engine/src/ai.mjs. Nothing here
// does arithmetic on them beyond formatting: a second implementation of the
// scoring in the browser is how the CLI and the app start disagreeing about
// the same crawl, and this file has no business being the reason.
//
// Two things it insists on saying out loud, because both are load-bearing and
// both are invisible if the panel only prints numbers:
//
//   1. **This is a different scale from the score.** None of it moves the
//      hundred. A site can be an A here and a C there and neither is wrong.
//   2. **A pillar can score 100 without having been looked at.** `coverage`
//      is how much of it the run was in a position to ask about, and a 100 at
//      40% coverage is shown as what it is rather than as a clean bill.
//
// Layout note, learned by rendering it: the three pillars are a summary row
// and their signals are a full-width list underneath, not three columns of
// prose. In three columns at a laptop width each signal gets about 300px, and
// "An assistant quotes a passage, not a page" wraps to six lines. The row is
// for comparing three numbers; the list is for reading. Splitting them also
// puts the three meters on one line, which is the only way a reader can
// compare them at a glance.

import { useState } from 'react';

import { bandOf, gradeColor, ChartFrame, DataTable, Legend, Meter, StackedBar, StateDot } from './viz';
import type { AiPillar, AiReadiness, AiSignal } from './types';

/** What the two words mean here, said once and in plain terms.
 *
 *  Worth writing down because the field does not agree: the GEO Optimizer
 *  project treats AEO and GEO as synonyms for the same practice, and Canonry's
 *  aeo-audit never uses "GEO" at all. Splitting them is a choice this report
 *  makes, so it owes the reader the definition it is using rather than letting
 *  two numbers appear under two acronyms and mean whatever the reader assumed. */
const PILLAR_NOTE: Record<string, string> = {
  access: 'Nothing below this matters if a crawler is refused at the door.',
  aeo: 'AEO — being the answer. Whether a passage can be lifted whole and attributed.',
  geo: 'GEO — being cited in generated text. Sources, numbers, quotations.',
};

const PILLAR_LONG: Record<string, string> = {
  access:
    'Answered by whoever owns the domain. robots.txt and llms.txt decide whether an assistant reads the site at all, and a site that publishes both owes them the same answer.',
  aeo:
    'Answer Engine Optimisation — being the answer. An assistant quotes a passage, not a page: this is whether there is one to lift, and whether the page permits it being repeated.',
  geo:
    'Generative Engine Optimisation — being cited in generated text. The levers here are the ones the Princeton GEO study measured across ten thousand queries: citing sources, giving numbers, quoting people.',
};

const pct = (n: number) => `${Math.round(n)}%`;

/** The summary row. One line of numbers per pillar, and because everything
 *  above the meter is exactly one line high, the three meters line up. */
function PillarTile({ pillar }: { pillar: AiPillar }) {
  const color = gradeColor(pillar.grade);
  return (
    <a
      href={`#ai-${pillar.key}`}
      className="card block p-5 transition-colors duration-150 ease-out hover:border-ink/20"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="truncate font-semibold tracking-[-0.015em]">{pillar.name}</h4>
        {/* Proportional figures: this is a standalone value, and tabular-nums
            gives every digit the width of a zero, which reads loose here. */}
        <span className="shrink-0 text-[2rem] leading-none font-semibold" style={{ color }}>
          {pillar.score}
        </span>
      </div>

      <div className="t-eyebrow mt-1 flex items-baseline justify-between gap-2 text-ink/40">
        <span className="truncate">out of 100</span>
        <span className="shrink-0">
          {pillar.grade} · {bandOf(pillar.score)}
        </span>
      </div>

      <div className="mt-3.5">
        <Meter value={pillar.score} fill={color} label={`${pillar.name} readiness`} />
      </div>

      <p className="t-num mt-2.5 text-xs tabular-nums text-ink/50">
        {pillar.passed} passed · {pillar.failed} failed
        {pillar.skipped ? ` · ${pillar.skipped} not checked` : ''}
      </p>
      {/* Coverage is only worth saying when it is not the whole story. It is a
          caveat, not a statistic: the reason a good number here might not have
          been earned. */}
      {pillar.coverage < 100 && (
        <p className="mt-1 text-xs text-ink/40">Measured on {pct(pillar.coverage)} of this pillar</p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-ink/45">{PILLAR_NOTE[pillar.key]}</p>
    </a>
  );
}

/** One signal, at the length a reader can act on.
 *
 *  A failing signal opens with its reason and its fix visible; a passing one
 *  is one line. That asymmetry is the point — a report where every row is the
 *  same size is a report where the four that matter are hidden among thirty. */
function SignalRow({ signal, pages }: { signal: AiSignal; pages: number }) {
  const [open, setOpen] = useState(signal.state === 'failed');
  const failed = signal.state === 'failed';
  const skipped = signal.state === 'skipped';

  return (
    <li className="border-b border-line/60 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors duration-150 ease-out hover:bg-ink/[0.02]"
      >
        <span className="mt-0.5">
          <StateDot state={signal.state} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-semibold tracking-[-0.011em]">{signal.label}</span>
            <code className="rounded bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-ink/45">
              {signal.id}
            </code>
          </span>
          {/* The measured fact, before any advice about it. On a page-scope
              signal that is a prevalence — "on 9 of 40 pages" — which is what
              decides whether this is a template bug or a one-off. */}
          <span className="t-num mt-1 block text-xs tabular-nums text-ink/50">
            {skipped ? (
              <span className="text-ink/45">Not checked — {signal.whySkipped}</span>
            ) : failed ? (
              <>
                {signal.scope === 'page'
                  ? `On ${signal.pages} of ${pages} ${pages === 1 ? 'page' : 'pages'} · ${pct((signal.spread ?? 0) * 100)} of the crawl`
                  : 'Site-wide'}
                {signal.recoverable ? (
                  <span className="text-ink/40">
                    {' '}
                    · fixing it returns {signal.recoverable} of this pillar&rsquo;s 100
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-ink/45">
                Passing
                {signal.sharePct
                  ? ` · worth ${signal.sharePct} of this pillar's 100`
                  : ' · reported, not counted'}
              </span>
            )}
          </span>
        </span>

        {/* What fixing this line hands back, out of the pillar's hundred.
            One quantity, one hue, and the same scale on every row — the first
            version drew `sharePct` here in red on a failing row and grey on a
            passing one, so the bar meant "what it is worth" while the sentence
            beside it meant "what you would get back", and nothing on screen
            said which. A row with nothing to recover draws nothing rather than
            an empty track, because an empty track reads as a measured zero. */}
        <span className="hidden w-24 shrink-0 pt-2 sm:block">
          {signal.recoverable ? (
            <Meter
              value={signal.recoverable}
              fill="var(--color-viz-critical)"
              height={6}
              label={`${signal.label}: fixing it returns ${signal.recoverable} of this pillar's 100`}
            />
          ) : null}
        </span>

        <span
          aria-hidden
          className={`mt-0.5 shrink-0 text-ink/30 transition-transform duration-200 ease-out ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </button>

      {open && (
        <div className="enter-fade max-w-3xl space-y-2 pb-4 pl-13 pr-5">
          <p className="text-sm leading-relaxed text-ink/65">{signal.why}</p>
          {!skipped && (
            <p className="text-sm leading-relaxed">
              <span className="t-eyebrow mr-2 text-ink/40">Fix</span>
              <span className="text-ink/75">{signal.fix}</span>
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** A pillar's signals, full width. Worst first: a reader deciding what to do
 *  next is asking which line buys the most, and that is the recoverable share,
 *  not the alphabet. */
function PillarSection({ pillar, pages }: { pillar: AiPillar; pages: number }) {
  const color = gradeColor(pillar.grade);
  const signals = [...pillar.signals].sort(
    (a, b) =>
      (b.recoverable ?? -1) - (a.recoverable ?? -1) ||
      Number(a.state === 'skipped') - Number(b.state === 'skipped') ||
      (b.sharePct ?? 0) - (a.sharePct ?? 0),
  );

  return (
    <section id={`ai-${pillar.key}`} className="card scroll-mt-20 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 pb-4">
        <div className="min-w-0 max-w-2xl">
          <h4 className="font-semibold tracking-[-0.015em]">{pillar.name}</h4>
          <p className="mt-1.5 text-sm leading-relaxed text-ink/55">{PILLAR_LONG[pillar.key]}</p>
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-2xl font-semibold" style={{ color }}>
            {pillar.score}
          </span>
          <span className="t-eyebrow text-ink/40">
            {pillar.grade} · {bandOf(pillar.score)}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-line bg-canvas px-5 py-2">
        <span className="t-eyebrow text-ink/40">Signal</span>
        <span className="t-eyebrow hidden w-24 shrink-0 text-ink/40 sm:block">To regain</span>
      </div>
      <ul>
        {signals.map((signal) => (
          <SignalRow key={signal.id} signal={signal} pages={pages} />
        ))}
      </ul>
    </section>
  );
}

export default function AiPanel({ ai, pages }: { ai: AiReadiness; pages: number }) {
  const color = gradeColor(ai.grade);

  return (
    <div className="space-y-4">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 max-w-xl">
            <h3 className="t-eyebrow text-ink/45">Answer &amp; generative engines</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-ink/60">
              What ChatGPT, Claude, Perplexity and Gemini get when they read this site — whether
              they are let in, whether there is a passage worth lifting, and whether the page
              carries what a model weighs when it picks which source to cite.
            </p>
            {/* The sentence that keeps the two numbers from being read as one.
                Without it the AI score and the SEO score sit side by side on a
                page and look like two attempts at the same measurement. */}
            <p className="mt-3 text-xs leading-relaxed text-ink/45">
              A separate scale from the SEO score above, and it takes nothing off it. Each pillar
              is scored out of the signals this run was in a position to ask about, so a pillar
              with half its checks skipped says so rather than banking the points.
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[3rem] leading-none font-semibold" style={{ color }}>
              {ai.score}
            </div>
            <div className="t-eyebrow mt-2 text-ink/40">
              {ai.grade} · {bandOf(ai.score)}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <Meter value={ai.score} fill={color} height={10} label="Overall answer-engine readiness" />
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ai.pillars.map((pillar) => (
          <PillarTile key={pillar.key} pillar={pillar} />
        ))}
      </div>

      <ChartFrame
        title="What each pillar was able to check"
        caption="Passed, failed, and not applicable to this run. A pillar that is mostly grey was not measured — which is a different thing from a pillar that passed."
        legend={
          <Legend
            items={[
              { color: 'var(--color-viz-good)', label: 'Passed' },
              { color: 'var(--color-viz-critical)', label: 'Failed' },
              { color: 'var(--color-viz-none)', label: 'Not checked' },
            ]}
          />
        }
        table={
          <DataTable
            columns={['Pillar', 'Score', 'Passed', 'Failed', 'Not checked', 'Coverage']}
            align={['left', 'right', 'right', 'right', 'right', 'right']}
            rows={ai.pillars.map((p) => [p.name, p.score, p.passed, p.failed, p.skipped, pct(p.coverage)])}
          />
        }
      >
        <div className="space-y-4">
          {ai.pillars.map((p) => (
            <div key={p.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3">
              <span className="truncate text-sm font-medium text-ink/80">{p.name}</span>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <StackedBar
                    title={`${p.name}: ${p.passed} passed, ${p.failed} failed, ${p.skipped} not checked`}
                    segments={[
                      { value: p.passed, color: 'var(--color-viz-good)', label: 'Passed' },
                      { value: p.failed, color: 'var(--color-viz-critical)', label: 'Failed' },
                      { value: p.skipped, color: 'var(--color-viz-none)', label: 'Not checked' },
                    ]}
                  />
                </div>
                <span className="t-num shrink-0 text-xs tabular-nums text-ink/45">
                  {p.passed}/{p.passed + p.failed + p.skipped}
                </span>
              </div>
            </div>
          ))}
        </div>
      </ChartFrame>

      {ai.pillars.map((pillar) => (
        <PillarSection key={pillar.key} pillar={pillar} pages={pages} />
      ))}
    </div>
  );
}
