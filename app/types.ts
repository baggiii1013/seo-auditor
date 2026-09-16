// The shape the engine streams back on `event: done` from /stream?format=json.
// Mirrors worker/index.mjs — findings, the grouping the CLI's --json carries,
// and the same scoreRun() every other front end shows.

export type Level = 'error' | 'warn' | 'note' | 'info';

export type Finding = {
  level: Level;
  id: string;
  title: string;
  detail?: string;
  url?: string;
};

export type Cause = {
  id: string;
  title: string;
  level: Level;
  section?: string;
  everywhere?: boolean;
  count: number;
  pages: string[];
  scope: string;
  position?: number;
  area: string;
};

// Flattened by scoreRun() before it returns — `pass` is the sentence, and
// `why` is only on a skipped row. There is no nested `check` object on the
// wire, whatever the internal rows look like in engine/src/score.mjs.
export type CheckRow = {
  id: string;
  area: string;
  pass: string;
  worst?: Level;
  why?: string;
};

export type Score = {
  score: number | null;
  grade: string | null;
  why?: string;
  ifErrorsFixed?: number;
  lost?: number;
  checks?: { passed: number; failed: number; skipped: number };
  weights?: Record<string, number>;
  passed?: CheckRow[];
  failed?: CheckRow[];
  skipped?: CheckRow[];
  areas?: { name: string; lost: number; passed: number; failed: number }[];
};

export type Meta = {
  origin: string;
  pages: number;
  ignored: number;
  requests: number;
  ms: number;
  date: string;
  notIndexable?: number;
  sitemap?: string;
  applicable?: Record<string, boolean>;
  hosts?: unknown;
};

export type Report = {
  meta: Meta;
  findings: Finding[];
  causes: Cause[];
  score: Score;
  sitemap?: string;
  llms?: string;
  schema?: string;
};

export const LEVELS: Record<Level, { label: string; dot: string; text: string; ring: string }> = {
  error: { label: 'Error', dot: 'bg-rose-500', text: 'text-rose-600', ring: 'ring-rose-500/20' },
  warn: { label: 'Warning', dot: 'bg-amber-500', text: 'text-amber-700', ring: 'ring-amber-500/20' },
  note: { label: 'Note', dot: 'bg-sky-500', text: 'text-sky-700', ring: 'ring-sky-500/20' },
  info: { label: 'Note', dot: 'bg-sky-500', text: 'text-sky-700', ring: 'ring-sky-500/20' },
};
