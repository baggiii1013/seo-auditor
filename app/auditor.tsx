'use client';

import { useEffect, useRef, useState } from 'react';

import type { Field } from '@/engine/src/options.mjs';

import ReportView from './report';
import type { Report } from './types';

type Plan = {
  reachable?: boolean;
  rateLimited?: boolean;
  origin?: string;
  redirected?: { from: string };
  sitemap?: string | null;
  listed?: number;
  wouldCheck?: number | null;
  limit?: number;
  skippedByLimit?: number;
  excluded?: number;
  sections?: { path: string; count: number }[];
  requests: number;
  ms: number;
};

type Agents = { browsers: string[]; systems: string[] };

const input =
  'w-full rounded-lg border border-line bg-white/[0.06] px-3 py-2 text-sm text-ink outline-none transition duration-150 ease-out placeholder:text-ink/50 focus:border-brand focus:ring-2 focus:ring-brand/15';

const ghost =
  'rounded-lg border border-line bg-white/[0.06] px-4 py-2 text-sm font-medium text-ink/70 transition duration-150 ease-out hover:border-ink/25 hover:text-ink active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100';

const solid =
  'rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm transition duration-150 ease-out hover:bg-[#ef5314] active:scale-[0.98] disabled:opacity-35 disabled:active:scale-100';

function Control({
  field,
  agents,
  value,
  onChange,
}: {
  field: Field;
  agents: Agents;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = `f-${field.query}`;

  if (field.type === 'checkbox') {
    return (
      <div className="sm:col-span-2">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            id={id}
            type="checkbox"
            checked={value === (field.value ?? '1')}
            onChange={(e) => onChange(e.target.checked ? (field.value ?? '1') : '')}
            className="mt-0.5 size-4 accent-brand"
          />
          <span>
            <span className="text-sm font-medium text-ink/80">{field.label}</span>
            {field.help && <span className="mt-0.5 block text-xs text-ink/50">{field.help}</span>}
          </span>
        </label>
      </div>
    );
  }

  let control;
  if (field.type === 'select') {
    control = (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={input}>
        {field.choices?.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'agent') {
    const names = field.which === 'browser' ? agents.browsers : agents.systems;
    control = (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={input}>
        <option value="">Default</option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={id}
        type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
        min={field.min}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={input}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink/80">
        {field.label}
      </label>
      <div className="mt-1.5">{control}</div>
      {field.help && <p className="mt-1.5 text-xs text-ink/50">{field.help}</p>}
    </div>
  );
}

/** Four bars reading a page. CSS, not JS: the crawl is streaming SSE and React
 *  re-renders on every line, and a rAF loader would drop frames doing it. */
function Scanner({ running }: { running: boolean }) {
  return (
    <div aria-hidden className="flex h-11 w-12 shrink-0 items-end gap-[3px]">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-full flex-1 rounded-[3px] bg-brand ${running ? 'scan-bar' : 'origin-bottom scale-y-[0.3] opacity-25'}`}
        />
      ))}
    </div>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The engine refuses a bare host — `targetFor` in worker/index.mjs wants the
 *  scheme — so a typed `example.com` gets one here. Any scheme is left alone,
 *  not just http(s): `ftp://x` has to reach the engine's own "only http and
 *  https" message rather than become `https://ftp://x`. */
const withScheme = (raw: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

function Crawl({
  host,
  log,
  phases,
  running,
  error,
  onStop,
  onBack,
}: {
  host: string;
  log: string[];
  phases: string[];
  running: boolean;
  error: string | null;
  onStop: () => void;
  onBack: () => void;
}) {
  const tail = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);

  // Block body on purpose. A concise arrow hands React whatever the expression
  // evaluated to, React stores that as the cleanup function, and calling it on
  // the next log line takes the whole tree down mid-crawl.
  useEffect(() => {
    tail.current?.scrollIntoView({ block: 'end' });
  }, [log]);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const current = phases.at(-1);

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-5 px-6 py-5">
          <Scanner running={running} />
          <div className="min-w-0 flex-1">
            <h2 className="t-title truncate">{host}</h2>
            <p aria-live="polite" className="t-num mt-1 text-sm text-ink/55">
              {running
                ? `${current ?? 'starting'} · ${mmss(elapsed)} · ${log.length} events`
                : error
                  ? 'stopped on an error'
                  : 'stopped'}
            </p>
          </div>
          <button onClick={running ? onStop : onBack} className={ghost}>
            {running ? 'Stop' : 'Back'}
          </button>
        </div>

        {/* The pipeline comes out of the log itself, in the order the engine
            reached each phase. Hardcoding it here would drift the moment a
            phase is added upstream. */}
        {phases.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-line px-6 py-4">
            {phases.map((name) => (
              <span
                key={name}
                className={`t-eyebrow rounded-full px-2.5 py-1.5 transition-colors duration-200 ease-out ${
                  name === current && running ? 'bg-brand/12 text-brand' : 'bg-ink/[0.045] text-ink/45'
                }`}
              >
                {name}
              </span>
            ))}
          </div>
        )}

        <div className="max-h-[22rem] overflow-auto border-t border-line bg-ink/[0.02] px-6 py-4 font-mono text-xs leading-[1.75] text-ink/60">
          {log.map((line, i) => (
            <div key={i} className="log-line whitespace-pre-wrap">
              {line}
            </div>
          ))}
          <div ref={tail} />
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      )}
    </div>
  );
}

export default function Auditor({ fields, agents }: { fields: Field[]; agents: Agents }) {
  const [url, setUrl] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [phases, setPhases] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const source = useRef<EventSource | null>(null);

  useEffect(() => () => source.current?.close(), []);

  const params = () => {
    const search = new URLSearchParams({ url: withScheme(url.trim()) });
    for (const field of fields) {
      const value = values[field.query];
      if (value) search.set(field.query, value);
    }
    return search;
  };

  const preview = async () => {
    setError(null);
    setPlan(null);
    setPreviewing(true);
    try {
      const res = await fetch(`/api/engine/preview?${params()}`);
      if (!res.ok) throw new Error(await res.text());
      setPlan(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  const run = () => {
    setError(null);
    setPlan(null);
    setReport(null);
    setLog([]);
    setPhases([]);
    setRunning(true);

    const search = params();
    search.set('format', 'json');
    const es = new EventSource(`/api/engine/stream?${search}`);
    source.current = es;

    es.addEventListener('progress', (e) => {
      const line: string = JSON.parse(e.data);
      // progressText() pads the phase to 9 columns, so the name is the head of
      // every line. Accumulated here rather than derived from `log` because the
      // log is capped and the early phases would fall out of the window.
      const name = line.slice(0, 9).trim();
      if (name && name !== 'note') setPhases((p) => (p.includes(name) ? p : [...p, name]));
      // Capped: a large crawl streams thousands of lines, and a DOM holding
      // every one of them is what makes the page stutter, not the crawl.
      setLog((lines) => [...lines, line].slice(-400));
    });
    es.addEventListener('done', (e) => {
      setReport(JSON.parse(e.data));
      setRunning(false);
      es.close();
    });
    es.addEventListener('failed', (e) => {
      setError(JSON.parse(e.data));
      setRunning(false);
      es.close();
    });
    // EventSource reconnects on a closed stream, so a failure that is not one of
    // the two events above has to stop it here or the crawl starts again.
    es.onerror = () => {
      es.close();
      setRunning(false);
      setError((was) => was ?? 'The connection to the engine dropped.');
    };
  };

  const stop = () => {
    source.current?.close();
    setRunning(false);
  };

  if (report) return <ReportView report={report} onReset={() => setReport(null)} />;

  if (running || log.length > 0) {
    return (
      <Crawl
        host={url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        log={log}
        phases={phases}
        running={running}
        error={error}
        onStop={stop}
        onBack={() => {
          setLog([]);
          setPhases([]);
          setError(null);
        }}
      />
    );
  }

  const busy = running || previewing;

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <label htmlFor="url" className="block text-sm font-medium text-ink/80">
          Site to audit
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="url"
            type="text"
            inputMode="url"
            value={url}
            placeholder="example.com"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && url && !busy && run()}
            className={`${input} flex-1 sm:text-base`}
          />
          <div className="flex gap-2">
            <button onClick={preview} disabled={!url || busy} className={ghost}>
              {previewing ? 'Looking…' : 'Preview'}
            </button>
            <button onClick={run} disabled={!url || busy} className={solid}>
              Audit
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink/50">
          It crawls the sitemap and checks every page, not just the home page. A big site is
          minutes — preview first if you are not sure.
        </p>

        <button
          onClick={() => setAdvanced((v) => !v)}
          className="mt-5 text-sm font-medium text-ink/55 underline underline-offset-2 transition-colors duration-150 ease-out hover:text-ink"
        >
          {advanced ? 'Hide options' : `Options (${fields.length})`}
        </button>

        {advanced && (
          <div className="enter-fade mt-5 grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
            {fields.map((field) => (
              <Control
                key={field.query}
                field={field}
                agents={agents}
                value={values[field.query] ?? (field.checked ? (field.value ?? '1') : '')}
                onChange={(next) => setValues((v) => ({ ...v, [field.query]: next }))}
              />
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      {plan && (
        <div className="card p-6">
          <h3 className="t-eyebrow text-ink/45">What a crawl would do</h3>
          <dl className="mt-4 space-y-2 text-sm">
            {(
              [
                ['Would read', plan.origin],
                ['Redirects from', plan.redirected?.from],
                ['Sitemap', plan.sitemap ?? 'none found; links would be followed from the home page'],
                ['URLs listed', plan.listed?.toLocaleString()],
                [
                  'Would check',
                  plan.wouldCheck === null
                    ? `up to ${plan.limit}, since there is no sitemap to count`
                    : plan.wouldCheck?.toLocaleString(),
                ],
                ['Past the limit', plan.skippedByLimit?.toLocaleString()],
                ['Excluded', plan.excluded?.toLocaleString()],
                ...(plan.sections ?? []).map(
                  (s) => [s.path, `${s.count.toLocaleString()} URLs`] as const,
                ),
                ['This preview cost', `${plan.requests} requests, ${(plan.ms / 1000).toFixed(1)}s`],
              ] as [string, string | undefined][]
            )
              .filter(([, value]) => value !== undefined && value !== null)
              .map(([name, value]) => (
                <div key={name} className="grid grid-cols-[10rem_1fr] gap-4">
                  <dt className="text-ink/50">{name}</dt>
                  <dd className="t-num break-all text-ink/90">{value}</dd>
                </div>
              ))}
          </dl>
          {plan.reachable === false && (
            <p className="mt-4 text-sm text-rose-600">
              {plan.rateLimited
                ? 'Every request came back HTTP 429. Wait, or set the speed to Gentle.'
                : `${plan.origin} did not return a single response.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
