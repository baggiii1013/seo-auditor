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
  'w-full rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-sm outline-none transition placeholder:text-white/25 focus:border-white/30';

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
  const label = (
    <label htmlFor={id} className="block text-sm font-medium text-white/70">
      {field.label}
    </label>
  );

  if (field.type === 'checkbox') {
    return (
      <div className="sm:col-span-2">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            id={id}
            type="checkbox"
            checked={value === (field.value ?? '1')}
            onChange={(e) => onChange(e.target.checked ? (field.value ?? '1') : '')}
            className="mt-0.5 size-4 accent-emerald-400"
          />
          <span>
            <span className="text-sm font-medium text-white/70">{field.label}</span>
            {field.help && <span className="mt-0.5 block text-xs text-white/35">{field.help}</span>}
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
          <option key={v} value={v} className="bg-neutral-900">
            {text}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'agent') {
    const names = field.which === 'browser' ? agents.browsers : agents.systems;
    control = (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={input}>
        <option value="" className="bg-neutral-900">
          Default
        </option>
        {names.map((name) => (
          <option key={name} value={name} className="bg-neutral-900">
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
      {label}
      <div className="mt-1.5">{control}</div>
      {field.help && <p className="mt-1.5 text-xs text-white/35">{field.help}</p>}
    </div>
  );
}

export default function Auditor({ fields, agents }: { fields: Field[]; agents: Agents }) {
  const [url, setUrl] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const source = useRef<EventSource | null>(null);
  const tail = useRef<HTMLDivElement>(null);

  useEffect(() => () => source.current?.close(), []);
  // Block body on purpose. A concise arrow hands React whatever the expression
  // evaluated to, React stores that as the cleanup function, and calling it on
  // the next log line takes the whole tree down mid-crawl.
  useEffect(() => {
    tail.current?.scrollIntoView({ block: 'end' });
  }, [log]);

  const params = () => {
    const search = new URLSearchParams({ url });
    for (const field of fields) {
      const value = values[field.query];
      if (value) search.set(field.query, value);
    }
    return search;
  };

  const preview = async () => {
    setError(null);
    setPlan(null);
    setRunning(true);
    try {
      const res = await fetch(`/api/engine/preview?${params()}`);
      if (!res.ok) throw new Error(await res.text());
      setPlan(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const run = () => {
    setError(null);
    setPlan(null);
    setReport(null);
    setLog([]);
    setRunning(true);

    const search = params();
    search.set('format', 'json');
    const es = new EventSource(`/api/engine/stream?${search}`);
    source.current = es;

    es.addEventListener('progress', (e) => setLog((lines) => [...lines, JSON.parse(e.data)]));
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

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6">
        <label htmlFor="url" className="block text-sm font-medium text-white/70">
          Site to audit
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="url"
            type="url"
            value={url}
            placeholder="https://example.com"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && url && !running && run()}
            className={`${input} flex-1 sm:text-base`}
          />
          <div className="flex gap-2">
            <button
              onClick={preview}
              disabled={!url || running}
              className="rounded-lg border border-white/12 px-4 py-2 text-sm text-white/70 transition hover:border-white/25 hover:text-white disabled:opacity-40"
            >
              Preview
            </button>
            <button
              onClick={running ? stop : run}
              disabled={!url}
              className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-neutral-950 transition hover:bg-white/85 disabled:opacity-30"
            >
              {running ? 'Stop' : 'Audit'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-white/35">
          It crawls the sitemap and checks every page, not just the home page. A big site is
          minutes — preview first if you are not sure.
        </p>

        <button
          onClick={() => setAdvanced((v) => !v)}
          className="mt-5 text-sm text-white/45 underline underline-offset-2 hover:text-white/80"
        >
          {advanced ? 'Hide options' : `Options (${fields.length})`}
        </button>

        {advanced && (
          <div className="mt-5 grid gap-5 border-t border-white/8 pt-5 sm:grid-cols-2">
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
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      {plan && (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6">
          <h3 className="text-xs font-medium tracking-[0.18em] text-white/35">
            WHAT A CRAWL WOULD DO
          </h3>
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
                  <dt className="text-white/40">{name}</dt>
                  <dd className="break-all text-white/80">{value}</dd>
                </div>
              ))}
          </dl>
          {plan.reachable === false && (
            <p className="mt-4 text-sm text-rose-300">
              {plan.rateLimited
                ? 'Every request came back HTTP 429. Wait, or set the speed to Gentle.'
                : `${plan.origin} did not return a single response.`}
            </p>
          )}
        </div>
      )}

      {log.length > 0 && (
        <div className="rounded-2xl border border-white/8 bg-black/40 p-5">
          <div className="mb-3 flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${running ? 'animate-pulse bg-emerald-400' : 'bg-white/20'}`}
            />
            <h3 className="text-xs font-medium tracking-[0.18em] text-white/35">
              {running ? 'CRAWLING' : 'CRAWL LOG'}
            </h3>
          </div>
          <div className="max-h-80 overflow-auto font-mono text-xs leading-relaxed text-white/45">
            {log.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {line}
              </div>
            ))}
            <div ref={tail} />
          </div>
        </div>
      )}
    </div>
  );
}
