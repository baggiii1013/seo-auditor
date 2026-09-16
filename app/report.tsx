'use client';

import { useMemo, useState } from 'react';

import { LEVELS, type Cause, type CheckRow, type Level, type Report } from './types';

const GRADE_COLOR: Record<string, string> = {
  A: '#34d399',
  B: '#a3e635',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#fb7185',
};

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
  const color = GRADE_COLOR[grade] ?? '#a3e635';
  const r = 54;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative grid size-36 shrink-0 place-items-center">
      <svg viewBox="0 0 128 128" className="size-36 -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" strokeWidth="9" className="text-white/8" />
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
        <div className="text-4xl font-semibold tabular-nums tracking-tight">{score}</div>
        <div className="text-xs font-medium tracking-[0.18em] text-white/40">{grade}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] tracking-wide text-white/40">{label}</div>
    </div>
  );
}

function Areas({ areas }: { areas: NonNullable<Report['score']['areas']> }) {
  const worst = Math.max(...areas.map((a) => a.lost), 1);
  return (
    <div className="space-y-2">
      {areas.map((area) => (
        <div key={area.name} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-sm">
          <div className="truncate text-white/70">{area.name}</div>
          <div className="h-2 overflow-hidden rounded-full bg-white/6">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500 transition-[width] duration-700"
              style={{ width: `${area.lost ? Math.max(3, (area.lost / worst) * 100) : 0}%` }}
            />
          </div>
          <div className="tabular-nums text-white/40">
            <span className={area.lost ? 'text-rose-300' : 'text-emerald-300'}>
              {area.lost ? `−${area.lost}` : '0'}
            </span>
            <span className="ml-2 text-white/25">
              {area.passed}/{area.passed + area.failed}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CauseCard({ cause }: { cause: Cause }) {
  const [open, setOpen] = useState(false);
  const level = LEVELS[cause.level] ?? LEVELS.note;
  const shown = open ? cause.pages : cause.pages.slice(0, 3);
  return (
    <div className={`rounded-xl border border-white/8 bg-white/[0.02] p-4 ring-1 ring-inset ${level.ring}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${level.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h4 className="font-medium">{cause.title}</h4>
            <code className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-white/40">
              {cause.id}
            </code>
          </div>
          <p className="mt-1 text-sm text-white/50">{cause.scope}</p>
          {shown.length > 0 && (
            <ul className="mt-3 space-y-1">
              {shown.map((page) => (
                <li key={page} className="truncate font-mono text-xs">
                  <a
                    href={page}
                    target="_blank"
                    rel="noreferrer"
                    className="text-white/45 underline decoration-white/15 underline-offset-2 hover:text-white/80"
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
              className="mt-2 text-xs text-white/40 underline underline-offset-2 hover:text-white/70"
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
    <section className="rounded-2xl border border-white/8 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-medium">
          {title} <span className="ml-1 text-white/35 tabular-nums">{count}</span>
        </span>
        <span className={`text-white/30 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && <div className="border-t border-white/8 px-5 py-4">{children}</div>}
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{host}</h2>
          <p className="mt-1 text-sm text-white/40">
            {meta.pages} pages · {meta.requests} requests · {(meta.ms / 1000).toFixed(1)}s ·{' '}
            {meta.date}
            {meta.ignored ? ` · ${meta.ignored} silenced` : ''}
          </p>
        </div>
        <button
          onClick={onReset}
          className="rounded-lg border border-white/12 px-4 py-2 text-sm text-white/70 transition hover:border-white/25 hover:text-white"
        >
          New audit
        </button>
      </header>

      <section className="flex flex-wrap items-center gap-8 rounded-2xl border border-white/8 bg-white/[0.02] p-6">
        {score.score === null ? (
          <p className="text-white/60">{score.why ?? 'There was nothing to score.'}</p>
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

      {score.areas && score.areas.length > 0 && (
        <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-6">
          <h3 className="mb-4 text-xs font-medium tracking-[0.18em] text-white/35">
            POINTS LOST BY AREA
          </h3>
          <Areas areas={score.areas} />
        </section>
      )}

      {byArea.length > 0 ? (
        byArea.map(([area, list]) => (
          <section key={area} className="space-y-3">
            <h3 className="text-xs font-medium tracking-[0.18em] text-white/35">
              {area.toUpperCase()}
            </h3>
            {list.map((cause) => (
              <CauseCard key={cause.id} cause={cause} />
            ))}
          </section>
        ))
      ) : (
        <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-6 text-emerald-200">
          Nothing to fix. Every check that applied to this run passed.
        </section>
      )}

      <Collapsible title="Passing" count={score.passed?.length ?? 0}>
        <ul className="grid gap-x-6 gap-y-1.5 text-sm text-white/55 sm:grid-cols-2">
          {score.passed?.map((row: CheckRow) => (
            <li key={row.id} className="flex gap-2">
              <span className="text-emerald-400">✓</span>
              <span>{row.pass}</span>
            </li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="Not checked" count={score.skipped?.length ?? 0}>
        <p className="mb-3 text-sm text-white/40">
          These did not apply to this run and are not counted either way — a check that could not
          run is not a check that passed.
        </p>
        <ul className="space-y-1.5 text-sm text-white/55">
          {score.skipped?.map((row: CheckRow) => (
            <li key={row.id} className="flex gap-2">
              <span className="text-white/25">·</span>
              <span>
                {row.pass}
                {row.why && <span className="text-white/35"> — {row.why}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Collapsible>

      <section className="flex flex-wrap gap-2 rounded-2xl border border-white/8 bg-white/[0.02] p-5">
        <span className="mr-2 self-center text-xs font-medium tracking-[0.18em] text-white/35">
          EXPORT
        </span>
        {(['html', 'markdown', 'csv'] as const).map((as) => (
          <button
            key={as}
            onClick={() => save(as)}
            disabled={busy !== null}
            className="rounded-lg border border-white/12 px-3 py-1.5 text-sm text-white/70 transition hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            {busy === as ? 'Rendering…' : as === 'markdown' ? 'Markdown' : as.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() =>
            download(`${host}-${meta.date}.json`, JSON.stringify(report, null, 2), 'application/json')
          }
          className="rounded-lg border border-white/12 px-3 py-1.5 text-sm text-white/70 transition hover:border-white/25 hover:text-white"
        >
          JSON
        </button>
        {generated.map(([name, body, type]) =>
          body ? (
            <button
              key={name}
              onClick={() => download(name, body, type)}
              className="rounded-lg border border-emerald-400/25 px-3 py-1.5 text-sm text-emerald-200 transition hover:border-emerald-400/50"
            >
              {name}
            </button>
          ) : null,
        )}
      </section>
    </div>
  );
}
