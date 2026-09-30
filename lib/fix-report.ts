// A finished fix as a spreadsheet: what the audit found, what the model did
// about each finding, every file it changed line by line, and what the sandbox
// made of it. Downloaded by the fix panel the moment a fix finishes.

import type { Report } from '../app/types.ts';
import type { Job, Repo } from './db.ts';
import { diffLines } from './diff.ts';
import { fixables } from './fixable.ts';
import { verdict } from './pull.ts';
import { xlsx, type Sheet } from './xlsx.ts';

const LEVEL = { error: 'Error', warn: 'Warning', note: 'Note', info: 'Note' } as const;

/** The workbook, and the name to save it under. `kept` is null once the
 *  audit is gone: the findings are then named by their ids alone. */
export function fixReport(job: Job, kept: Report | null, repo: Repo | null): { name: string; file: Buffer } {
  const out = job.output;
  const asked = kept ? fixables(kept).filter((f) => job.input.checks.includes(f.id)) : [];
  const said = new Map(out?.findings.map((f) => [f.id, f]));
  const fixed = out?.findings.filter((f) => f.status === 'fixed').length ?? 0;
  const host = kept ? new URL(kept.meta.origin).host : repo ? `${repo.owner}-${repo.name}` : 'site';

  const summary: Sheet = {
    name: 'Summary',
    widths: [24, 100],
    rows: [
      ['SEO fix report', host],
      ['Site', kept?.meta.origin ?? ''],
      ['Audited', kept?.meta.date ?? ''],
      ['Score at the audit', kept?.score ? `${kept.score.score} (${kept.score.grade})` : ''],
      ['Repository', repo ? `${repo.owner}/${repo.name}` : ''],
      ['Changed from', out ? `${out.base.branch} @ ${out.base.sha.slice(0, 7)}` : ''],
      ['Started', job.createdAt],
      ['Outcome', job.pr ? `Pull request #${job.pr.number} (${job.pr.state})` : (job.error ?? job.status)],
      ['Pull request', job.pr?.url ?? 'Not opened'],
      ['Findings fixed', `${fixed} of ${out?.findings.length ?? 0}`],
      ['Files changed', out?.files.length ?? 0],
      ['Tokens', `${job.tokens.in.toLocaleString('en')} in, ${job.tokens.out.toLocaleString('en')} out`],
      ['What the model says', out?.summary ?? ''],
      ...(job.input.request ? [['Your request', job.input.request]] : []),
      ['Note', 'Written by a model from the audit and the repository. Review the pull request before merging.'],
    ],
  };

  const problems: Sheet = {
    name: 'Problems and fixes',
    widths: [26, 34, 10, 12, 60, 8, 10, 70],
    rows: [
      ['Check', 'Problem', 'Severity', 'Where', 'What the audit found', 'Pages', 'Outcome', 'What was done, or why not'],
      ...job.input.checks.map((id) => {
        const f = asked.find((a) => a.id === id);
        const s = said.get(id);
        return [
          id,
          f?.title ?? '',
          f ? LEVEL[f.level] : '',
          f ? (f.kind === 'file' ? 'Site file' : 'Page markup') : '',
          f?.detail ?? '',
          f?.pages.length ?? '',
          s?.status ?? 'not reported',
          s?.why ?? '',
        ];
      }),
      ...(job.input.request
        ? [['request', 'Your request', '', '', job.input.request, '', said.get('request')?.status ?? 'not reported', said.get('request')?.why ?? '']]
        : []),
    ],
  };

  // Each page a picked check was seen on, with the audit's own words for it
  // there when it had some.
  const pages: Sheet = {
    name: 'Pages affected',
    widths: [26, 34, 60, 70],
    rows: [
      ['Check', 'Problem', 'Page', 'What the audit saw there'],
      ...asked.flatMap((f) =>
        f.pages.map((page) => [
          f.id,
          f.title,
          page,
          kept!.findings.find((x) => x.id === f.id && x.url === page)?.detail ?? f.detail,
        ]),
      ),
    ],
  };

  const files: Sheet = {
    name: 'Files changed',
    widths: [40, 10, 8, 8, 120],
    rows: [
      ['File', 'Change', 'Added', 'Removed', 'Diff'],
      ...(out?.files ?? []).map((file) => {
        const lines = diffLines(file.before ?? '', file.after);
        const count = (op: '+' | '-') => lines.filter((l) => l.op === op).length;
        const text = lines
          .map((l) => (l.op === '…' ? `⋯ ${l.count} unchanged ${l.count === 1 ? 'line' : 'lines'}` : `${l.op} ${l.text}`))
          .join('\n');
        return [file.path, file.before === null ? 'New' : 'Changed', count('+'), count('-'), text];
      }),
    ],
  };

  const checks: Sheet = {
    name: 'Sandbox checks',
    widths: [30, 40, 120],
    rows: [
      ['Command', 'Result', 'Output'],
      ...(out?.checks?.length
        ? out.checks.map((c) => [c.command, verdict(c), c.ok ? '' : c.tail])
        : [['', 'Not run: there was no sandbox, so the changes were not built.', '']]),
    ],
  };

  return {
    name: `seo-fix-${host}-${job.createdAt.slice(0, 10)}.xlsx`,
    file: xlsx([summary, problems, pages, files, checks]),
  };
}
