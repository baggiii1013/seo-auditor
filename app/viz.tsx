'use client';

// Chart parts, built to the data-viz method rather than to taste.
//
// The rules that show up here as code rather than as comments:
//
//   * **Status, not categorical.** Every series in this report means good or
//     bad — a check that failed, a point lost. Identity hues are for telling
//     Acme from Globex; spending one on "this is the bad one" is the collision
//     the method names. Warning and serious sit below 3:1 on white, so nothing
//     drawn in them ever travels without an icon and a text label.
//   * **A 2px surface gap, never a border.** Touching marks are separated by
//     white, in the stacked bar and between adjacent bars alike.
//   * **Selective direct labels.** A value at the tip of a bar, not beside
//     every segment. Interior stack segments get no inline label — there is no
//     free end to put one on — and the legend and the table carry them.
//   * **A table view for every chart.** Not a fallback: a twin. A tooltip that
//     is the only way to read a value gates the data behind a mouse.
//   * **Marks are thin.** Bars cap at 10px here; the rows are dense and a fat
//     bar in a list of twelve reads as a progress meter rather than a chart.

import { useId, useState } from 'react';

/** Grade to the four status tokens. Five grades, four tokens, and the letter
 *  is always printed beside the mark — so A and B sharing a colour costs
 *  nothing a reader can trip over, and no mark carries meaning by hue alone. */
export const STATUS_OF_GRADE: Record<string, string> = {
  A: 'var(--color-viz-good)',
  B: 'var(--color-viz-good)',
  C: 'var(--color-viz-warning)',
  D: 'var(--color-viz-serious)',
  F: 'var(--color-viz-critical)',
};

export const gradeColor = (grade: string | null | undefined) =>
  STATUS_OF_GRADE[grade ?? ''] ?? 'var(--color-viz-none)';

/** What a score is called, so the number has a word beside it. Canonry gates
 *  at 70 and Auriti bands at 86/68/36; these are our own grade boundaries said
 *  in words, rather than a fourth set of thresholds nobody can reconcile. */
export const bandOf = (score: number) =>
  score >= 90 ? 'Strong' : score >= 80 ? 'Good' : score >= 70 ? 'Fair' : score >= 60 ? 'Weak' : 'Poor';

/** The icon half of "never colour alone". Text, not an SVG set: it is read by
 *  a screen reader as the word it is labelled with, and it cannot drift from
 *  the colour it sits beside. */
export function StateDot({ state, size = 'sm' }: { state: 'passed' | 'failed' | 'skipped'; size?: 'sm' | 'md' }) {
  const look = {
    passed: { bg: 'var(--color-viz-good)', mark: '✓', label: 'Passed' },
    failed: { bg: 'var(--color-viz-critical)', mark: '!', label: 'Failed' },
    skipped: { bg: 'var(--color-viz-none)', mark: '·', label: 'Not checked' },
  }[state];
  return (
    <span
      role="img"
      aria-label={look.label}
      title={look.label}
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${
        size === 'md' ? 'size-5 text-[11px]' : 'size-4 text-[10px]'
      }`}
      style={{ background: look.bg }}
    >
      {look.mark}
    </span>
  );
}

/** A single ratio against a limit. The method's "meter": the fill carries
 *  severity and the track is a lighter step of the fill's own ramp, so the
 *  state reads across the whole bar rather than only across the filled part. */
export function Meter({
  value,
  fill,
  height = 8,
  label,
}: {
  value: number;
  fill: string;
  height?: number;
  label: string;
}) {
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="viz-track w-full overflow-hidden rounded-full"
      style={{ height, ['--viz-fill' as string]: fill }}
    >
      <div
        className="viz-grow h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: fill }}
      />
    </div>
  );
}

/** The toggle every chart here carries. A chart and its table are the same
 *  data; which one is showing is a reader's choice, not a capability. */
export function ChartFrame({
  title,
  caption,
  legend,
  table,
  children,
}: {
  title: string;
  caption?: string;
  legend?: React.ReactNode;
  table: React.ReactNode;
  children: React.ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-eyebrow text-ink/45">{title}</h3>
          {caption && <p className="mt-2 max-w-xl text-sm text-ink/55">{caption}</p>}
        </div>
        <button
          onClick={() => setAsTable((v) => !v)}
          aria-expanded={asTable}
          aria-controls={id}
          className="t-eyebrow shrink-0 rounded-full border border-line px-3 py-1.5 text-ink/50 transition-colors duration-150 ease-out hover:border-ink/25 hover:text-ink"
        >
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {legend && <div className="mt-4">{legend}</div>}
      <div id={id} className="mt-4">
        {asTable ? <div className="enter-fade overflow-x-auto">{table}</div> : children}
      </div>
    </section>
  );
}

/** A legend, always present for two or more series. The swatch carries the
 *  hue and the word carries the meaning, so neither is doing the job alone. */
export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs text-ink/60">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A plain table. Shared by every chart's table view so they read alike, and
 *  so a value is never only reachable by hovering something. */
export function DataTable({
  columns,
  rows,
  align = [],
}: {
  columns: string[];
  rows: (string | number)[][];
  align?: ('left' | 'right')[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line">
          {columns.map((c, i) => (
            <th
              key={c}
              scope="col"
              className={`t-eyebrow pb-2 text-ink/45 ${align[i] === 'right' ? 'text-right' : 'text-left'}`}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-line/60 last:border-0">
            {row.map((cell, j) => (
              <td
                key={j}
                className={`py-2 ${align[j] === 'right' ? 't-num text-right tabular-nums' : ''} ${
                  j === 0 ? 'font-medium text-ink/80' : 'text-ink/60'
                }`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A horizontal bar in a list of them. One hue for every bar — the categories
 *  are nominal and the length already encodes the value, so colouring each bar
 *  by its own size would spend the identity channel restating the length.
 *
 *  The value rides the tip of the bar rather than a gridline, and the hit area
 *  is the whole row rather than the 10px mark. */
export function BarRow({
  label,
  value,
  max,
  display,
  fill,
  tooltip,
  href,
  trailing,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  fill: string;
  tooltip: string;
  href?: string;
  trailing?: React.ReactNode;
}) {
  const Row = href ? 'a' : 'div';
  // A zero-value bar draws nothing rather than a 3px stub: a stub reads as a
  // small amount, and nothing lost is not a small amount lost.
  const pct = max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <Row
      {...(href ? { href } : {})}
      title={tooltip}
      className={`group grid min-h-9 grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 rounded-lg px-1 text-sm ${
        href ? 'transition-colors duration-150 ease-out hover:bg-ink/[0.04]' : ''
      }`}
    >
      <span className="truncate font-medium text-ink/80">{label}</span>
      <span className="flex items-center gap-2">
        <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
          {pct > 0 && (
            <span
              className="viz-grow absolute inset-y-0 left-0 rounded-r-[4px]"
              style={{ width: `${pct}%`, background: fill }}
            />
          )}
        </span>
        <span className="t-num shrink-0 text-xs tabular-nums text-ink/70">{display}</span>
      </span>
      <span className="t-num shrink-0 text-xs tabular-nums text-ink/55">{trailing}</span>
    </Row>
  );
}

/** Part-to-whole across one row. Segments are separated by a 2px gap in the
 *  surface colour, never a stroke, and an interior segment carries no inline
 *  label — the legend and the table say what it is. */
export function StackedBar({
  segments,
  height = 10,
  title,
}: {
  segments: { value: number; color: string; label: string }[];
  height?: number;
  title?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (!total) return null;
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div className="flex w-full overflow-hidden rounded-full" style={{ height }} title={title}>
      {shown.map((seg, i) => (
        <div
          key={seg.label}
          title={`${seg.label}: ${seg.value}`}
          className="viz-grow h-full first:rounded-l-full last:rounded-r-full"
          style={{
            width: `${(seg.value / total) * 100}%`,
            background: seg.color,
            // The spacer. White doing the separating, on every segment but the
            // first, so a run of segments never fuses into one block.
            marginLeft: i === 0 ? 0 : 2,
          }}
        />
      ))}
    </div>
  );
}
