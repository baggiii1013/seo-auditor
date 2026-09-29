// A model fixing findings in a repository it can read, and with a sandbox run.
//
// It gets five tools: list, read, edit, create, done. Edits are staged here in
// memory, and the only way anything leaves is a pull request a person opens
// from the diff — so a repository or a crawled page telling the model to do
// something else has nowhere to do it. With a sandbox (lib/sandbox.ts) it also
// gets `run`: a command in an offline container holding the checkout, whose
// output is all that comes back.
//
// Any OpenAI-compatible `/chat/completions` endpoint: AI_API_URL, AI_MODEL and
// (unless it is a local one) AI_API_KEY. Raw `fetch`, like everything else
// that talks to an API here.

import { readFileSync } from 'node:fs';

import type { JobOutput } from './db.ts';
import type { Fixable } from './fixable.ts';
import type { Snapshot } from './github.ts';

const config = () => {
  const base = (process.env.AI_API_URL ?? '').replace(/\/+$/, '');
  return {
    url: /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`,
    key: process.env.AI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? '',
  };
};

export const aiConfigured = () => Boolean(process.env.AI_API_URL && process.env.AI_MODEL);

// No cap unless AI_MAX_TURNS sets one: how many round trips a fix needs is not
// knowable up front. The budget below and the model's own `done` end it.
const MAX_TURNS = Number(process.env.AI_MAX_TURNS) || Infinity;
const MAX_FILES = 20;
const MAX_READ = 100_000;
// No cap unless AI_TOKEN_BUDGET sets one: the tokens a whole run may spend,
// input and output summed, because the input grows every turn and is most of
// the bill. Per-user spend caps come with billing.
const TOKEN_BUDGET = Number(process.env.AI_TOKEN_BUDGET) || Infinity;

/** Paths the model may never write: CI, secrets, lockfiles, server config,
 *  and WordPress core, config and uploads — an update overwrites core, and a
 *  mistake in the rest takes the whole site down. */
const DENIED =
  /^\.github\/|(^|\/)(\.env[^/]*|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|node_modules\/.*|\.htaccess|web\.config|wp-config\.php|(wp-admin|wp-includes|wp-content\/uploads|wp-content\/cache)\/.*)$|(^|\/)web\/wp\//;

/** A path as the Git tree spells it — relative, forward slashes, no climbing. */
const badPath = (path: unknown) =>
  typeof path !== 'string' ||
  !path ||
  path.startsWith('/') ||
  path.includes('\\') ||
  path.split('/').some((part) => !part || part === '.' || part === '..');

/** The repository as the model sees it: the base commit plus whatever it has
 *  staged. Every tool answers with a string, errors included — the model reads
 *  the error and tries again, and nothing here throws on its account. */
export function workspace(paths: string[], read: (path: string) => Promise<string | null>) {
  const inTree = new Set(paths);
  const before = new Map<string, string | null>();
  const staged = new Map<string, string>();

  const current = async (path: string) => {
    if (staged.has(path)) return staged.get(path)!;
    if (!inTree.has(path)) return null;
    if (!before.has(path)) before.set(path, await read(path));
    return before.get(path) ?? null;
  };

  const writable = (path: unknown): string | null => {
    if (badPath(path)) return `"${path}" is not a repository path.`;
    if (DENIED.test(path as string)) return `${path} is off-limits: CI, secrets, lockfiles, server config and WordPress core are never changed.`;
    if (!staged.has(path as string) && staged.size >= MAX_FILES) return `Already ${MAX_FILES} files changed — that is the limit.`;
    return null;
  };

  const tools: Record<string, (args: Record<string, string>) => Promise<string>> = {
    async list_files({ prefix = '' }) {
      const all = [...new Set([...paths, ...staged.keys()])].filter((p) => p.startsWith(prefix)).sort();
      if (!all.length) return `Nothing under "${prefix}".`;
      return all.length > 500 ? `${all.slice(0, 500).join('\n')}\n… and ${all.length - 500} more — narrow the prefix.` : all.join('\n');
    },
    async read_file({ path }) {
      if (badPath(path)) return `"${path}" is not a repository path.`;
      const text = await current(path);
      if (text === null) return `No file at ${path}.`;
      return text.length > MAX_READ ? `${path} is ${text.length} characters — too large to read here.` : text;
    },
    async edit_file({ path, old, new: replacement }) {
      const refused = writable(path);
      if (refused) return refused;
      const text = await current(path);
      if (text === null) return `No file at ${path}. Use create_file for a new one.`;
      if (typeof old !== 'string' || !old) return '`old` must be the exact text to replace.';
      const count = text.split(old).length - 1;
      if (count !== 1) return count ? `\`old\` appears ${count} times in ${path} — include more context.` : `\`old\` is not in ${path}.`;
      staged.set(path, text.replace(old, () => String(replacement ?? '')));
      return `Edited ${path}.`;
    },
    async create_file({ path, content }) {
      const refused = writable(path);
      if (refused) return refused;
      if (inTree.has(path) || staged.has(path)) return `${path} already exists — read it and use edit_file.`;
      staged.set(path, String(content ?? ''));
      before.set(path, null);
      return `Created ${path}.`;
    },
  };

  return {
    tools,
    changes: (): JobOutput['files'] =>
      [...staged]
        .filter(([path, after]) => before.get(path) !== after)
        .map(([path, after]) => ({ path, before: before.get(path) ?? null, after })),
  };
}

const fn = (name: string, description: string, properties: object, required: string[]) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});
const str = (description: string) => ({ type: 'string', description });

const TOOLS = [
  fn('list_files', 'List file paths in the repository under a prefix ("" for all).', { prefix: str('Path prefix') }, []),
  fn('read_file', 'Read a file as it stands, including your own staged changes.', { path: str('Repository path') }, ['path']),
  fn(
    'edit_file',
    'Replace one exact, unique piece of text in an existing file.',
    { path: str('Repository path'), old: str('Exact text to replace; must appear once'), new: str('Replacement') },
    ['path', 'old', 'new'],
  ),
  fn('create_file', 'Create a new file. Refuses a path that exists.', { path: str('Repository path'), content: str('Whole file') }, [
    'path',
    'content',
  ]),
  fn(
    'done',
    'Finish. Give every finding id you were asked about a status and one sentence of why.',
    {
      summary: str('What you changed, for the pull request, in a few sentences'),
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: str('Finding id'), status: { type: 'string', enum: ['fixed', 'skipped'] }, why: str('One sentence') },
          required: ['id', 'status', 'why'],
        },
      },
    },
    ['summary', 'findings'],
  ),
];

const RUN = fn(
  'run',
  "Run a shell command in an offline sandbox: the repository at its commit with your staged changes laid over it, dependencies installed. Use it for the site's build, lint or tests, and `php -l`. What a command writes is thrown away; only edit_file and create_file change anything.",
  { command: str('A shell command, run from the repository root') },
  ['command'],
);

// The model's instructions live in seo-agent.md at the repository root, read
// on every run so an edit there takes effect without a restart. It asks; the
// limits above and the tools' refusals are what hold.
// A WordPress repository also gets seo-agent-wordpress.md: its PHP takes the
// whole site down on one mistake, and much of what a crawl sees lives in the
// database rather than the repository.
// Each URL spelled out whole: Turbopack cannot follow a built one.
const instructions = (wordpress: boolean) =>
  [new URL('../seo-agent.md', import.meta.url), ...(wordpress ? [new URL('../seo-agent-wordpress.md', import.meta.url)] : [])]
    .map((url) => readFileSync(url, 'utf8'))
    .join('\n\n');

/** A WordPress site, Bedrock project or theme, told by its tree. A plugin on
 *  its own has nothing in its paths to tell it by. */
export const isWordPress = (paths: string[]) =>
  paths.some((p) => /(^|\/)(wp-config(-sample)?\.php|functions\.php|theme\.json)$|(^|\/)wp-content\//.test(p));

/** What the model is told: the findings, the files, and the crawl's facts.
 *  Exported for the test, which checks the untrusted parts are fenced. */
export function brief(o: {
  origin: string;
  repo: string;
  snap: Snapshot;
  checks: Fixable[];
  drafts: { sitemapUrls?: string[]; sitemapRefused?: string | null; llms?: string | null; llmsRefused?: string | null };
}): string {
  const files = o.snap.paths.length > 400 ? [...o.snap.paths.slice(0, 400), `… and ${o.snap.paths.length - 400} more (use list_files)`] : o.snap.paths;
  const out = [
    `Site: ${o.origin}`,
    `Repository: ${o.repo}, branch ${o.snap.branch} at ${o.snap.sha.slice(0, 7)}.${o.snap.truncated ? ' GitHub truncated the file list, so some files may not appear in it.' : ''}`,
    '',
    'Files:',
    ...files,
    '',
    'Findings to fix. The ids are the ones to report on in done.',
    '<crawl>',
  ];
  for (const c of o.checks) {
    out.push(`## ${c.id} — ${c.title} (${c.level})`, c.detail);
    if (c.pages.length) out.push(`Pages: ${c.pages.slice(0, 10).join(' ')}${c.pages.length > 10 ? ` and ${c.pages.length - 10} more` : ''}`);
    out.push('');
  }
  if (o.checks.some((c) => c.kind === 'file')) {
    out.push('## Indexable URLs the crawl found (the engine\'s sitemap draft)');
    out.push(o.drafts.sitemapUrls?.length ? o.drafts.sitemapUrls.slice(0, 300).join('\n') : `None — ${o.drafts.sitemapRefused ?? 'not drafted'}`);
    out.push('', "## The engine's llms.txt draft");
    out.push(o.drafts.llms ? o.drafts.llms.slice(0, 15_000) : `None — ${o.drafts.llmsRefused ?? 'not drafted'}`);
  }
  out.push('</crawl>');
  return out.join('\n');
}

type Message = Record<string, unknown>;
type ToolCall = { id: string; function: { name: string; arguments: string } };

async function chat(messages: Message[], tools: object[], stop: AbortSignal) {
  const c = config();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) },
      body: JSON.stringify({ model: c.model, messages, tools, tool_choice: 'auto' }),
      signal: AbortSignal.any([stop, AbortSignal.timeout(180_000)]),
    });
    if (res.ok) {
      return (await res.json()) as {
        choices: { message: { content?: string | null; tool_calls?: ToolCall[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
    }
    // Busy or rate-limited is worth two more tries; anything else is an answer.
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    throw new Error(`The model API answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** Run the model until it calls done, and hand back what it staged. */
export async function runFix(o: {
  origin: string;
  repo: string;
  snap: Snapshot;
  checks: Fixable[];
  drafts: Parameters<typeof brief>[0]['drafts'];
  read: (path: string) => Promise<string | null>;
  onLog: (line: string, tokens: { in: number; out: number }) => void;
  /** Aborted by Stop: the request in flight is cut and nothing more is asked. */
  stop: AbortSignal;
  /** The sandbox's `run`, when there is one: a command on the staged changes. */
  run?: (command: string, files: JobOutput['files']) => Promise<string>;
}): Promise<JobOutput> {
  const ws = workspace(o.snap.paths, o.read);
  const tokens = { in: 0, out: 0 };
  const wordpress = isWordPress(o.snap.paths);
  if (wordpress) o.onLog('WordPress repository: following seo-agent-wordpress.md too', tokens);
  const messages: Message[] = [
    { role: 'system', content: instructions(wordpress) },
    { role: 'user', content: brief(o) },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await chat(messages, o.run ? [...TOOLS, RUN] : TOOLS, o.stop);
    tokens.in += res.usage?.prompt_tokens ?? 0;
    tokens.out += res.usage?.completion_tokens ?? 0;
    if (tokens.in + tokens.out > TOKEN_BUDGET) throw new Error(`Stopped at the budget of ${TOKEN_BUDGET.toLocaleString()} tokens.`);

    const message = res.choices?.[0]?.message;
    if (!message) throw new Error('The model API answered without a message.');
    const calls = message.tool_calls ?? [];
    messages.push({ role: 'assistant', content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      messages.push({ role: 'user', content: 'Carry on with the tools, and call done when you are finished.' });
      continue;
    }

    for (const call of calls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Those arguments were not valid JSON.' });
        continue;
      }
      const name = call.function.name;
      if (name === 'done') {
        const asked = new Set(o.checks.map((c) => c.id));
        const said = (Array.isArray(args.findings) ? args.findings : []).filter(
          (f): f is JobOutput['findings'][number] => asked.has(f?.id) && (f.status === 'fixed' || f.status === 'skipped'),
        );
        // A finding the model never mentioned was not fixed, whatever it did.
        for (const id of asked) {
          if (!said.some((f) => f.id === id)) said.push({ id, status: 'skipped', why: 'The model did not report on it.' });
        }
        // Nor was anything fixed by a run that changed no file.
        const files = ws.changes();
        const findings = files.length
          ? said
          : said.map((f) => (f.status === 'fixed' ? { ...f, status: 'skipped' as const, why: `Said fixed, but no file was changed. (${f.why})` } : f));
        o.onLog('done', tokens);
        return { base: { branch: o.snap.branch, sha: o.snap.sha }, summary: String(args.summary ?? ''), findings, files };
      }
      const tool = name === 'run' && o.run ? () => o.run!(String(args.command ?? ''), ws.changes()) : ws.tools[name];
      const result = tool ? await tool(args as Record<string, string>) : `There is no tool called ${name}.`;
      // A read's result is the file, so the log names it instead; an edit's
      // result is already the sentence worth showing, refusals included; a
      // command's first line is its exit code.
      o.onLog(
        name === 'list_files'
          ? `listed ${args.prefix || 'the repository'}`
          : name === 'read_file'
            ? `read ${args.path}`
            : name === 'run'
              ? `ran ${args.command}: ${result.split('\n')[0]}`
              : result,
        tokens,
      );
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  throw new Error(`The model used all ${MAX_TURNS} turns without finishing.`);
}
