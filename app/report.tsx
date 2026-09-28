'use client';

import { useMemo, useState } from 'react';

import AiPanel from './ai-panel';
import GitPanel from './git-panel';
import type { GitState } from '@/lib/git-state';
import { LEVELS, type Cause, type CheckRow, type Level, type Report, type Score } from './types';
import {
  bandOf,
  gradeColor,
  BarRow,
  ChartFrame,
  DataTable,
  Legend,
  StackedBar,
  StateDot,
} from './viz';

const ghost =
  'rounded-lg border border-line bg-white/[0.06] px-4 py-2 text-sm font-medium text-ink/70 transition duration-150 ease-out hover:border-ink/25 hover:text-ink active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100';

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
  // From the copy the server kept of this run, by its id.
  const res = await fetch(`/api/audits/${report.id}/export?as=${as}`);
  if (!res.ok) throw new Error(await res.text());
  return res.text();
}

// The one hero figure on the page. Its colour is the status scale, the same
// four tokens every other mark here uses, rather than a private five-step ramp
// — A and B sharing a green costs nothing, because the letter is printed in
// the middle of the ring.
function Ring({ score, grade }: { score: number; grade: string }) {
  const color = gradeColor(grade);
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
          className="ring-grow"
          style={{ ['--ring-circumference' as string]: circumference }}
        />
      </svg>
      <div className="absolute text-center">
        {/* Proportional figures on a standalone number: tabular-nums gives
            every digit the width of a zero, which reads loose at this size. */}
        <div className="text-[2.75rem] leading-none font-semibold">{score}</div>
        <div className="t-eyebrow mt-1.5 text-ink/45">
          {grade} · {bandOf(score)}
        </div>
      </div>
    </div>
  );
}

/** A stat tile: label, value, and — when there is one — the sentence that says
 *  what the number is of. The hint is the verbose half; a bare "7" under
 *  "Warnings" is a number a reader has to go and interpret somewhere else. */
function Stat({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string | number;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-canvas px-4 py-3">
      <div className="flex items-baseline gap-2">
        {color && <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />}
        <span className="text-xl font-semibold">{value}</span>
      </div>
      <div className="t-eyebrow mt-1 text-ink/45">{label}</div>
      {hint && <div className="mt-1.5 text-xs leading-snug text-ink/45">{hint}</div>}
    </div>
  );
}

/** Points lost by area.
 *
 *  One hue for every bar, not a gradient per bar. The old version ran an
 *  amber-to-rose gradient inside each mark, which encoded the value twice —
 *  once as length, once as colour — and spent the only free channel restating
 *  what the bar already showed. The areas are nominal: they have no order of
 *  their own, so colour has no ordering to carry.
 *
 *  The hue is the status scale rather than a categorical slot, because the
 *  series means something bad. Every bar is labelled with its own number, so
 *  the colour is never the only thing saying how much.
 *
 *  Only the areas that actually produced a section can be linked. The score's
 *  area names and the causes' are not the same vocabulary, so the linkable set
 *  is passed in rather than guessed from `failed > 0`. */
function Areas({
  areas,
  linked,
}: {
  areas: NonNullable<Score['areas']>;
  linked: Set<string>;
}) {
  const worst = Math.max(...areas.map((a) => a.lost), 1);
  return (
    <div className="space-y-1">
      {areas.map((area) => (
        <BarRow
          key={area.name}
          label={area.name}
          value={area.lost}
          max={worst}
          display={area.lost ? `\u2212${area.lost}` : '0'}
          fill={area.lost ? 'var(--color-viz-critical)' : 'var(--color-viz-none)'}
          tooltip={`${area.name}: ${area.lost} points lost, ${area.passed} of ${area.passed + area.failed} checks passing`}
          href={linked.has(area.name) ? `#${slug(area.name)}` : undefined}
          trailing={`${area.passed}/${area.passed + area.failed}`}
        />
      ))}
    </div>
  );
}

/** How the checks came out, area by area. The composition the bar chart above
 *  cannot show: two areas can lose the same points with very different numbers
 *  of checks behind them, and "3 of 4 failed" is a different situation from
 *  "3 of 40". Status hues, each with a word in the legend. */
function AreaComposition({ areas }: { areas: NonNullable<Score['areas']> }) {
  return (
    <div className="space-y-3">
      {areas.map((area) => (
        <div key={area.name} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3">
          <span className="truncate text-sm font-medium text-ink/80">{area.name}</span>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <StackedBar
                title={`${area.name}: ${area.passed} passed, ${area.failed} failed`}
                segments={[
                  { value: area.passed, color: 'var(--color-viz-good)', label: 'Passed' },
                  { value: area.failed, color: 'var(--color-viz-critical)', label: 'Failed' },
                ]}
              />
            </div>
            <span className="t-num shrink-0 text-xs tabular-nums text-ink/45">
              {area.passed}/{area.passed + area.failed}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Every check the run touched, in one list.
 *
 *  This replaced two collapsibles — "Passing" and "Not checked" — that between
 *  them showed two thirds of the checklist and no way to look anything up. The
 *  failures were only ever visible as findings grouped by area, so the one
 *  question a reader actually asks of a checklist ("what about X?") had no
 *  answer anywhere in the report.
 *
 *  All three states in one table, filterable, with the area beside each row.
 *  The state is a dot *and* a word, never a colour on its own. */
function Inventory({ score, causes }: { score: Score; causes: Cause[] }) {
  const [filter, setFilter] = useState<'all' | 'failed' | 'passed' | 'skipped'>('all');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    // A failed row arrives without `pass`, and that is not an oversight: `pass`
    // is the sentence for a check that held, and this one did not. See the
    // three shapes scoreRun() returns in engine/src/score.mjs — only `passed`
    // and `skipped` carry it. The cause is where the failure's own sentence
    // lives, under the same id, and the id is the floor under both.
    //
    // Every row gets the label here rather than at each use, because the two
    // places that read it — the filter and the row — went out of step: the
    // filter called .toLowerCase() on it and took the whole report down on the
    // first keystroke, while the row rendered it blank and said nothing.
    const titles = new Map(causes.map((cause) => [cause.id, cause.title]));
    const tag = (list: CheckRow[] | undefined, state: 'passed' | 'failed' | 'skipped') =>
      (list ?? []).map((row) => ({
        ...row,
        state,
        label: row.pass ?? titles.get(row.id) ?? row.id,
      }));
    return [
      ...tag(score.failed, 'failed'),
      ...tag(score.passed, 'passed'),
      ...tag(score.skipped, 'skipped'),
    ];
  }, [score.failed, score.passed, score.skipped, causes]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (filter === 'all' || row.state === filter) &&
        (!needle || `${row.id} ${row.label} ${row.area}`.toLowerCase().includes(needle)),
    );
  }, [rows, filter, query]);

  if (!rows.length) return null;

  const counts = {
    all: rows.length,
    failed: rows.filter((r) => r.state === 'failed').length,
    passed: rows.filter((r) => r.state === 'passed').length,
    skipped: rows.filter((r) => r.state === 'skipped').length,
  };

  return (
    <section className="card overflow-hidden">
      <div className="px-6 pt-5 pb-4">
        <h3 className="t-eyebrow text-ink/45">Every check</h3>
        <p className="mt-2 max-w-2xl text-sm text-ink/55">
          The whole checklist and how this run came out on each line of it. A check that could not
          run is listed as not checked and counted in neither direction — a missing result reads
          exactly like a passing one, which is the failure this tool exists to refuse.
        </p>

        {/* One filter row above the thing it scopes, not per-section controls. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(['all', 'failed', 'passed', 'skipped'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`t-eyebrow rounded-full border px-3 py-1.5 transition duration-150 ease-out active:scale-[0.97] ${
                filter === key
                  ? 'border-ink/25 bg-ink/[0.05] text-ink'
                  : 'border-line text-ink/50 hover:border-ink/25 hover:text-ink'
              }`}
            >
              {key === 'all' ? 'All' : key === 'skipped' ? 'Not checked' : key}
              <span className="t-num ml-1.5 font-normal text-ink/55">{counts[key]}</span>
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a check…"
            aria-label="Filter checks"
            className="ml-auto min-w-40 rounded-full border border-line bg-white/[0.06] px-3.5 py-1.5 text-sm text-ink placeholder:text-ink/50 focus:border-ink/25 focus:outline-none"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="border-t border-line px-6 py-6 text-sm text-ink/50">
          Nothing matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="border-t border-line">
          {shown.map((row) => (
            <li
              key={`${row.state}-${row.id}`}
              className="flex items-start gap-3 border-b border-line/60 px-6 py-3 last:border-0"
            >
              <span className="mt-0.5">
                <StateDot state={row.state} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm text-ink/80">{row.label}</span>
                  <code className="rounded bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-ink/45">
                    {row.id}
                  </code>
                </div>
                {row.why && <p className="mt-1 text-xs text-ink/45">{row.why}</p>}
              </div>
              <span className="t-eyebrow shrink-0 pt-1 text-ink/50">{row.area}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
            <span className="ml-1 text-ink/55">{grade}</span>
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
          {area} <span className="t-num ml-0.5 text-ink/50">{list.length}</span>
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
                <li key={page} className="enter-fade truncate font-mono text-xs">
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

export default function ReportView({ report, git, onReset }: { report: Report; git: GitState; onReset: () => void }) {
  const { meta, causes } = report;

  // A run that reached nothing comes back with no `score` key at all — not a
  // null score, no key: `{ meta, findings, causes }` and an `unreachable`
  // finding. Everything below already draws the null-score case, so the only
  // thing missing was an object to read `null` off, and without it the whole
  // report threw on a site that simply did not answer.
  const score: Score = report.score ?? { score: null, grade: null };

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
        <div className="min-w-0">
          <h2 className="t-title text-page-ink">{host}</h2>
          {/* The crawl, in the terms the numbers below are counted in. A
              report that opens with a score and never says how many pages it
              read is asking to be trusted about a sample it never named. */}
          <p className="t-num mt-1.5 text-sm text-page-ink/70">
            {meta.pages} {meta.pages === 1 ? 'page' : 'pages'} crawled · {meta.requests} requests ·{' '}
            {(meta.ms / 1000).toFixed(1)}s · {meta.date}
          </p>
          {/* /70 rather than the /55 this would take on a flat floor: the
              background is lit, and a streak passing behind this line took it
              to 4.02:1 against its own brightest pixel. */}
          <p className="mt-1 text-xs text-page-ink/70">
            {meta.sitemap ? `Pages came from ${meta.sitemap}` : 'No sitemap was found — pages were reached by following links'}
            {meta.notIndexable ? ` · ${meta.notIndexable} not indexable` : ''}
            {meta.ignored ? ` · ${meta.ignored} findings silenced by config` : ''}
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
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Errors"
                  value={counts.error ?? 0}
                  color="var(--color-viz-critical)"
                  hint="Wrong, and costing the most per check."
                />
                <Stat
                  label="Warnings"
                  value={counts.warn ?? 0}
                  color="var(--color-viz-warning)"
                  hint="Worth fixing, worth a third of an error."
                />
                <Stat
                  label="Notes"
                  value={counts.note ?? 0}
                  color="var(--color-viz-info)"
                  hint="Reported only. None of these cost a point."
                />
                <Stat
                  label="If errors fixed"
                  value={score.ifErrorsFixed ?? '—'}
                  color="var(--color-viz-good)"
                  hint="The same sum with every error clean."
                />
              </div>
              {/* The arithmetic, offered rather than asked for. The score is a
                  deduction sheet and a reader is entitled to see the sheet. */}
              {score.checks && (
                <p className="t-num mt-3 text-xs tabular-nums text-ink/45">
                  {score.checks.passed} of {score.checks.passed + score.checks.failed} applicable
                  checks passed · {score.lost ?? 0} points lost
                  {score.checks.skipped ? ` · ${score.checks.skipped} did not apply to this run` : ''}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* Context for the findings below rather than a finding among them, so
          full width here and not in the masonry. */}
      <GitPanel origin={meta.origin} git={git} />

      <Jump score={score.score} grade={score.grade ?? '—'} areas={byArea} />

      {/* Everything below the headline numbers is a set of self-contained cards
          of wildly different heights, so it is flowed rather than stacked: on a
          wide screen a single column left two thirds of the display empty and
          put the last area section four scrolls down. Reading order is down a
          column and then across, which is what the order of these cards already
          was — each one is read on its own.

          The header, the score and the checklist stay out of it. The first two
          are the one hero row, and the checklist is a filterable list that can
          run to sixty rows: an unbreakable card that tall in a three-column
          balance is a column on its own with two empty ones beside it. */}
      <div className="masonry">
        {/* Above the area bars on purpose: it is the question people came with,
            and the bars answer "where is this site weak" rather than "can an
            assistant read it". Absent when the run had nothing to score for
            answer engines either, rather than drawn empty. */}
        {score.ai && <AiPanel ai={score.ai} pages={meta.pages} />}

        {score.areas && score.areas.length > 0 && (
          <>
            <ChartFrame
              title="Points lost by area"
              caption="Where the hundred went. Each bar is the points that area took off the score, not a score out of a hundred of its own — an area's share of the sheet is not a sheet."
              table={
                <DataTable
                  columns={['Area', 'Points lost', 'Passed', 'Failed']}
                  align={['left', 'right', 'right', 'right']}
                  rows={score.areas.map((a) => [a.name, a.lost, a.passed, a.passed + a.failed])}
                />
              }
            >
              <Areas areas={score.areas} linked={new Set(byArea.map(([area]) => area))} />
            </ChartFrame>

            <ChartFrame
              title="Checks by area"
              caption="How many checks sit behind each of those bars. Three failures out of four is a different situation from three out of forty, and the points alone cannot tell you which one you are looking at."
              legend={
                <Legend
                  items={[
                    { color: 'var(--color-viz-good)', label: 'Passed' },
                    { color: 'var(--color-viz-critical)', label: 'Failed' },
                  ]}
                />
              }
              table={
                <DataTable
                  columns={['Area', 'Passed', 'Failed', 'Pass rate']}
                  align={['left', 'right', 'right', 'right']}
                  rows={score.areas.map((a) => [
                    a.name,
                    a.passed,
                    a.failed,
                    `${Math.round((100 * a.passed) / Math.max(1, a.passed + a.failed))}%`,
                  ])}
                />
              }
            >
              <AreaComposition areas={score.areas} />
            </ChartFrame>
          </>
        )}

        {byArea.length > 0 ? (
          byArea.map(([area, list]) => (
            <section key={area} id={slug(area)} className="scroll-mt-20 space-y-3">
              {/* On the page, not on a card — the only heading in the masonry
                  that is. */}
              <h3 className="t-eyebrow text-page-ink/70">{area}</h3>
              {/* Keyed by id *and* scope, because the id is not unique. The
                  engine splits one check into several causes when it fires in
                  different parts of a site — `slow` on /learn/seo/ and `slow` on
                  /learn/pages-router/ are two rows with one id. On `key={id}`
                  React warned about duplicates and reserved the right to drop
                  one, which is a report quietly losing a finding. */}
              {list.map((cause, i) => (
                <CauseCard key={`${cause.id}-${cause.scope}-${i}`} cause={cause} />
              ))}
            </section>
          ))
        ) : (
          <section className="enter-scale rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-emerald-200">
            Nothing to fix. Every check that applied to this run passed.
          </section>
        )}
      </div>

      <Inventory score={score} causes={causes} />

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
