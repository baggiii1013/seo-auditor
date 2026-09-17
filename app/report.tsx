'use client';

import { useMemo, useState } from 'react';

import { LEVELS, type Cause, type CheckRow, type Level, type Report } from './types';

const GRADE_COLOR: Record<string, string> = {
  A: '#16a34a',
  B: '#65a30d',
  C: '#d97706',
  D: '#ea580c',
  F: '#e11d48',
};

const ghost =
  'rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink/70 transition duration-150 ease-out hover:border-ink/25 hover:text-ink active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100';

const slug = (area: string) => `area-${area.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

const download = (name: string, body: BlobPart, type: string) => {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

/** Every writer stays in engine/src/report.mjs — this asks the engine to render
 *  and never formats a report itself, so a file saved here and a file saved by
 *  the CLI are the same document. */
async function render(report: Report, as: 'html' | 'markdown' | 'csv') {
  const res = await fetch(`/api/engine/render?as=${as}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meta: report.meta, findings: report.findings, score: report.score }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.text();
}

function Ring({ score, grade }: { score: number; grade: string }) {
  const color = GRADE_COLOR[grade] ?? '#65a30d';
  const r = 54;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative grid size-36 shrink-0 place-items-center">
      <svg viewBox="0 0 128 128" className="size-36 -rotate-90">
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          className="text-ink/8"
        />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute text-center">
        <div className="t-num text-[2.75rem] leading-none font-semibold">{score}</div>
        <div className="t-eyebrow mt-1.5 text-ink/45">{grade}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-canvas px-4 py-3">
      <div className="t-num text-xl font-semibold">{value}</div>
      <div className="t-eyebrow mt-1 text-ink/45">{label}</div>
    </div>
  );
}

// --- AI & answer engines ----------------------------------------------------
// The one area that gets a panel of its own. Not because it is worth more than
// the others — the engine prices every check the same way and this changes none
// of that — but because it is the question people arrive with, and a reader who
// wants "can an assistant read my site" should not have to find row six of a
// bar chart to answer it.
//
// Everything below is derived from the payload already on the wire. No engine
// change, no second arithmetic: the numbers here are `score.areas`, `passed`,
// `failed` and `skipped` rearranged, and if they ever disagree with the area
// bar underneath them, this is the one that is wrong.
const AI_AREA = 'AI & answer engines';

/** What each check in the area is actually about, in a few words a reader who
 *  did not write the checklist can act on. Keyed by id rather than matched on
 *  prose, so a reworded `pass` sentence upstream does not silently fall out. */
const AI_CHECKS: Record<string, { label: string; blurb: string }> = {
  'ai-crawler-conflict': {
    label: 'Access',
    blurb: 'robots.txt and llms.txt agree about which assistants may read the site',
  },
  'aeo-no-answer-block': {
    label: 'Quotable',
    blurb: 'Pages answer a question in a passage an assistant can lift whole',
  },
  'aeo-boilerplate-heavy': {
    label: 'Signal',
    blurb: 'The words on the page are the page, not navigation and footer',
  },
  'geo-prompt-injection': {
    label: 'Trust',
    blurb: 'No hidden text addresses the model instead of the reader',
  },
};

/** Whether an assistant is allowed in, and what it finds once it is.
 *
 *  Reads the same three lists the rest of the report reads. A check absent from
 *  all three did not exist in this run and is simply not shown — inventing a row
 *  for it would be claiming a result the engine never produced. */
function AiPanel({ score, jumpTo }: { score: Report['score']; jumpTo: boolean }) {
  const area = score.areas?.find((a) => a.name === AI_AREA);
  if (!area) return null;

  const state = (id: string) =>
    score.failed?.some((r) => r.id === id)
      ? 'failed'
      : score.passed?.some((r) => r.id === id)
        ? 'passed'
        : score.skipped?.some((r) => r.id === id)
          ? 'skipped'
          : null;

  const rows = Object.entries(AI_CHECKS)
    .map(([id, meta]) => ({ id, ...meta, state: state(id) }))
    .filter((row) => row.state !== null);
  if (!rows.length) return null;

  const total = area.passed + area.failed;
  const skipped = rows.filter((r) => r.state === 'skipped').length;
  // Green is a claim, and it is only honest when the run was in a position to
  // make it. A one-page site with three of the four checks skipped came out
  // "1/1" in green — which reads as a clean bill of health for a run that
  // barely looked. Same rule as the engine's own: a check that could not run
  // is not a check that passed.
  const clean = area.failed === 0 && skipped === 0;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 pt-5 pb-4">
        <div>
          <h3 className="t-eyebrow text-ink/45">Answer &amp; generative engines</h3>
          <p className="mt-2 max-w-md text-sm text-ink/60">
            What ChatGPT, Claude, Perplexity and Gemini get when they read this site — whether
            they are let in, and whether there is anything quotable once they are.
          </p>
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className={`t-num text-3xl font-semibold ${clean ? 'text-emerald-600' : 'text-ink'}`}
          >
            {area.passed}
            <span className="text-ink/30">/{total}</span>
          </span>
          <span className="t-eyebrow text-ink/40">
            {skipped ? `checks · ${skipped} not run` : 'checks'}
          </span>
        </div>
      </div>

      <ul className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-3 bg-white px-6 py-4">
            <span
              aria-hidden
              className={`mt-1 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${
                row.state === 'failed'
                  ? 'bg-rose-500'
                  : row.state === 'passed'
                    ? 'bg-emerald-500'
                    : 'bg-ink/20'
              }`}
            >
              {row.state === 'failed' ? '!' : row.state === 'passed' ? '✓' : '·'}
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold tracking-[-0.011em]">{row.label}</span>
                {row.state === 'skipped' && (
                  <span className="t-eyebrow text-ink/35">not checked</span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-ink/55">{row.blurb}</p>
            </div>
          </li>
        ))}
      </ul>

      {/* Only offered when the area actually produced a section to land on —
          a clean area has no findings and the anchor would go nowhere. */}
      {jumpTo && area.failed > 0 && (
        <div className="border-t border-line px-6 py-3">
          <a
            href={`#${slug(AI_AREA)}`}
            className="text-sm font-medium text-brand underline underline-offset-2 transition-colors duration-150 ease-out hover:text-ink"
          >
            {area.failed === 1 ? 'See what to fix' : `See the ${area.failed} to fix`} →
          </a>
        </div>
      )}
    </section>
  );
}

/** Only the areas that actually produced a section can be linked. The score's
 *  area names and the causes' are not the same vocabulary, so the linkable set
 *  is passed in rather than guessed from `failed > 0`. */
function Areas({
  areas,
  linked,
}: {
  areas: NonNullable<Report['score']['areas']>;
  linked: Set<string>;
}) {
  const worst = Math.max(...areas.map((a) => a.lost), 1);
  return (
    <div className="space-y-2.5">
      {areas.map((area) => {
        const Row = linked.has(area.name) ? 'a' : 'div';
        return (
        <Row
          key={area.name}
          {...(linked.has(area.name) ? { href: `#${slug(area.name)}` } : {})}
          className={`grid grid-cols-[9rem_1fr_auto] items-center gap-3 rounded-lg text-sm ${
            linked.has(area.name) ? 'transition-colors duration-150 ease-out hover:bg-ink/[0.04]' : ''
          }`}
        >
          <div className="truncate font-medium text-ink/80">{area.name}</div>
          <div className="h-2 overflow-hidden rounded-full bg-ink/8">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500 transition-[width] duration-700 ease-out"
              style={{ width: `${area.lost ? Math.max(3, (area.lost / worst) * 100) : 0}%` }}
            />
          </div>
          <div className="t-num text-ink/50">
            <span className={area.lost ? 'text-rose-600' : 'text-emerald-600'}>
              {area.lost ? `−${area.lost}` : '0'}
            </span>
            <span className="ml-2 text-ink/35">
              {area.passed}/{area.passed + area.failed}
            </span>
          </div>
        </Row>
        );
      })}
    </div>
  );
}

/** Pins once you scroll past the score, which is exactly when the headline
 *  numbers leave the screen and a long report stops telling you where you are.
 *  Plain anchors: the browser already does the scrolling, the back button
 *  already undoes it. */
function Jump({
  score,
  grade,
  areas,
}: {
  score: number | null;
  grade: string | null;
  areas: [string, Cause[]][];
}) {
  if (areas.length < 2) return null;
  return (
    <nav
      aria-label="Jump to an area"
      className="chrome sticky top-3 z-10 flex items-center gap-2 overflow-x-auto rounded-full border border-line px-4 py-2 shadow-sm"
    >
      {score !== null && (
        <>
          <span className="t-num shrink-0 text-sm font-semibold">
            {score}
            <span className="ml-1 text-ink/40">{grade}</span>
          </span>
          <span className="h-4 w-px shrink-0 bg-line" />
        </>
      )}
      {areas.map(([area, list]) => (
        <a
          key={area}
          href={`#${slug(area)}`}
          className="t-eyebrow shrink-0 rounded-full px-2.5 py-1.5 text-ink/55 transition-colors duration-150 ease-out hover:bg-ink/[0.06] hover:text-ink"
        >
          {area} <span className="t-num ml-0.5 text-ink/35">{list.length}</span>
        </a>
      ))}
    </nav>
  );
}

function CauseCard({ cause }: { cause: Cause }) {
  const [open, setOpen] = useState(false);
  const level = LEVELS[cause.level] ?? LEVELS.note;
  const shown = open ? cause.pages : cause.pages.slice(0, 3);
  return (
    <div className={`card p-4 ring-1 ring-inset ${level.ring}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${level.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h4 className="font-semibold tracking-[-0.011em]">{cause.title}</h4>
            <code className="rounded bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-ink/45">
              {cause.id}
            </code>
          </div>
          <p className="mt-1 text-sm text-ink/60">{cause.scope}</p>
          {shown.length > 0 && (
            <ul className="mt-3 space-y-1">
              {shown.map((page) => (
                <li key={page} className="truncate font-mono text-xs">
                  <a
                    href={page}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink/55 underline decoration-ink/20 underline-offset-2 transition-colors duration-150 ease-out hover:text-brand"
                  >
                    {page}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {cause.pages.length > 3 && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-2 text-xs font-medium text-ink/50 underline underline-offset-2 transition-colors duration-150 ease-out hover:text-ink"
            >
              {open ? 'Show fewer' : `Show all ${cause.pages.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Collapsible({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <section className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors duration-150 ease-out hover:bg-ink/[0.02]"
      >
        <span className="font-semibold tracking-[-0.011em]">
          {title} <span className="t-num ml-1 font-normal text-ink/45">{count}</span>
        </span>
        <span
          className={`text-ink/35 transition-transform duration-200 ease-out ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </button>
      {open && <div className="enter-fade border-t border-line px-5 py-4">{children}</div>}
    </section>
  );
}

export default function ReportView({ report, onReset }: { report: Report; onReset: () => void }) {
  const { meta, causes, score } = report;
  const [busy, setBusy] = useState<string | null>(null);

  const host = useMemo(() => {
    try {
      return new URL(meta.origin).host;
    } catch {
      return meta.origin;
    }
  }, [meta.origin]);

  // Findings, not causes. A cause groups every page it is on, so counting those
  // gave "5 warnings" where the CLI and the Markdown both say 7 — and a report
  // from here has to be the same document as a report from the terminal.
  const counts = useMemo(() => {
    const tally = { error: 0, warn: 0, note: 0 };
    for (const finding of report.findings) tally[finding.level === 'info' ? 'note' : finding.level]++;
    return tally;
  }, [report.findings]);

  // Grouped by the area that fixes them, worst first — the same grouping the
  // engine's own HTML report uses, from the `area` it already put on each cause.
  const byArea = useMemo(() => {
    const order: Record<Level, number> = { error: 0, warn: 1, note: 2, info: 2 };
    const groups = new Map<string, Cause[]>();
    for (const cause of [...causes].sort((a, b) => order[a.level] - order[b.level])) {
      groups.set(cause.area, [...(groups.get(cause.area) ?? []), cause]);
    }
    return [...groups];
  }, [causes]);

  const save = async (as: 'html' | 'markdown' | 'csv') => {
    setBusy(as);
    try {
      const types = {
        html: ['html', 'text/html'],
        markdown: ['md', 'text/markdown'],
        csv: ['csv', 'text/csv'],
      } as const;
      const [ext, type] = types[as];
      download(`${host}-${meta.date}.${ext}`, await render(report, as), type);
    } catch (err) {
      alert(`Could not render that: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const generated: [string, string | undefined, string][] = [
    ['sitemap.xml', report.sitemap, 'application/xml'],
    ['llms.txt', report.llms, 'text/plain'],
    ['schema.json', report.schema, 'application/json'],
  ];

  return (
    <div className="enter-up space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="t-title">{host}</h2>
          <p className="t-num mt-1.5 text-sm text-ink/55">
            {meta.pages} pages · {meta.requests} requests · {(meta.ms / 1000).toFixed(1)}s ·{' '}
            {meta.date}
            {meta.ignored ? ` · ${meta.ignored} silenced` : ''}
          </p>
        </div>
        <button onClick={onReset} className={ghost}>
          New audit
        </button>
      </header>

      <section className="card flex flex-wrap items-center gap-8 p-6">
        {score.score === null ? (
          <p className="text-ink/70">{score.why ?? 'There was nothing to score.'}</p>
        ) : (
          <>
            <Ring score={score.score} grade={score.grade ?? '—'} />
            <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Errors" value={counts.error ?? 0} />
              <Stat label="Warnings" value={counts.warn ?? 0} />
              <Stat label="Notes" value={counts.note ?? 0} />
              <Stat label="If errors fixed" value={score.ifErrorsFixed ?? '—'} />
            </div>
          </>
        )}
      </section>

      <Jump score={score.score} grade={score.grade ?? '—'} areas={byArea} />

      {/* Above the area bars on purpose: it is the question people came with,
          and the bars answer "where is this site weak" rather than "can an
          assistant read it". */}
      <AiPanel score={score} jumpTo={byArea.some(([area]) => area === AI_AREA)} />

      {score.areas && score.areas.length > 0 && (
        <section className="card p-6">
          <h3 className="t-eyebrow mb-4 text-ink/45">Points lost by area</h3>
          <Areas areas={score.areas} linked={new Set(byArea.map(([area]) => area))} />
        </section>
      )}

      {byArea.length > 0 ? (
        byArea.map(([area, list]) => (
          <section key={area} id={slug(area)} className="scroll-mt-20 space-y-3">
            <h3 className="t-eyebrow text-ink/45">{area}</h3>
            {list.map((cause) => (
              <CauseCard key={cause.id} cause={cause} />
            ))}
          </section>
        ))
      ) : (
        <section className="enter-scale rounded-2xl border border-emerald-500/25 bg-emerald-50 p-6 text-emerald-800">
          Nothing to fix. Every check that applied to this run passed.
        </section>
      )}

      <Collapsible title="Passing" count={score.passed?.length ?? 0}>
        <ul className="grid gap-x-6 gap-y-1.5 text-sm text-ink/70 sm:grid-cols-2">
          {score.passed?.map((row: CheckRow) => (
            <li key={row.id} className="flex gap-2">
              <span className="text-emerald-600">✓</span>
              <span>{row.pass}</span>
            </li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="Not checked" count={score.skipped?.length ?? 0}>
        <p className="mb-3 text-sm text-ink/55">
          These did not apply to this run and are not counted either way — a check that could not
          run is not a check that passed.
        </p>
        <ul className="space-y-1.5 text-sm text-ink/70">
          {score.skipped?.map((row: CheckRow) => (
            <li key={row.id} className="flex gap-2">
              <span className="text-ink/30">·</span>
              <span>
                {row.pass}
                {row.why && <span className="text-ink/45"> — {row.why}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Collapsible>

      <section className="card flex flex-wrap gap-2 p-5">
        <span className="t-eyebrow mr-2 self-center text-ink/45">Export</span>
        {(['html', 'markdown', 'csv'] as const).map((as) => (
          <button
            key={as}
            onClick={() => save(as)}
            disabled={busy !== null}
            className={`${ghost} px-3 py-1.5`}
          >
            {busy === as ? 'Rendering…' : as === 'markdown' ? 'Markdown' : as.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() =>
            download(`${host}-${meta.date}.json`, JSON.stringify(report, null, 2), 'application/json')
          }
          className={`${ghost} px-3 py-1.5`}
        >
          JSON
        </button>
        {generated.map(([name, body, type]) =>
          body ? (
            <button
              key={name}
              onClick={() => download(name, body, type)}
              className="rounded-lg border border-brand/35 bg-brand/[0.06] px-3 py-1.5 text-sm font-medium text-brand transition duration-150 ease-out hover:border-brand/60 active:scale-[0.98]"
            >
              {name}
            </button>
          ) : null,
        )}
      </section>
    </div>
  );
}
