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
  /** The sentence for a check that held — so a *failed* row does not carry it.
   *  scoreRun() builds three different shapes and only `passed` and `skipped`
   *  get `pass`; `failed` gets cost, scope and pages instead. Declaring this
   *  required is what let `row.pass.toLowerCase()` past the compiler and into
   *  the filter, where it took the report down on the first keystroke. */
  pass?: string;
  worst?: Level;
  why?: string;
};

// The answer-engine sheet from engine/src/ai.mjs. A second scale that takes
// nothing off `score` — every field here is out of its own pillar, never out
// of the hundred, and the report has to keep saying so or the two numbers get
// read as one.
export type AiState = 'passed' | 'failed' | 'skipped';

export type AiSignal = {
  id: string;
  pillar: string;
  label: string;
  why: string;
  fix: string;
  weight: number;
  scope: 'site' | 'page';
  state: AiState;
  pages: number;
  /** Share of the crawl this signal is missing from, 0–1. Absent when skipped. */
  spread?: number;
  cost?: number;
  /** What this signal is worth of its pillar, and what fixing it hands back.
   *  Absent on a skipped signal, which is in no denominator. */
  sharePct?: number;
  recoverable?: number;
  /** Present only on a skipped row: why the run was not in a position to ask.
   *  Its own key, so `why` keeps meaning "why this matters" in every state. */
  whySkipped?: string;
};

export type AiPillar = {
  key: string;
  name: string;
  blurb: string;
  score: number;
  grade: string;
  possible: number;
  lost: number;
  passed: number;
  failed: number;
  skipped: number;
  /** How much of the pillar the run was in a position to ask about, 0–100. */
  coverage: number;
  signals: AiSignal[];
};

export type AiReadiness = {
  score: number;
  grade: string;
  possible: number;
  lost: number;
  pillars: AiPillar[];
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
  /** Null when the run had nothing to score for answer engines either. */
  ai?: AiReadiness | null;
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
  /** The server's id for this run — what exports are fetched by. */
  id: string;
  meta: Meta;
  findings: Finding[];
  causes: Cause[];
  /** Absent, not null, when the run had nothing to score — an unreachable host
   *  answers `done` with `{ meta, findings, causes }` and no `score` key. */
  score?: Score;
  /** The files this site should have had, drafted from the crawl. Each says
   *  `refused` instead when the crawl was too partial to write one from. */
  sitemap?: { xml: string | null; urls: string[]; refused: string | null };
  llms?: { text: string | null; refused: string | null };
  schema?: { json: string | null; refused: string | null };
};

export const LEVELS: Record<Level, { label: string; dot: string; text: string; ring: string }> = {
  error: { label: 'Error', dot: 'bg-rose-500', text: 'text-rose-600', ring: 'ring-rose-500/20' },
  warn: { label: 'Warning', dot: 'bg-amber-500', text: 'text-amber-700', ring: 'ring-amber-500/20' },
  note: { label: 'Note', dot: 'bg-sky-500', text: 'text-sky-700', ring: 'ring-sky-500/20' },
  info: { label: 'Note', dot: 'bg-sky-500', text: 'text-sky-700', ring: 'ring-sky-500/20' },
};
