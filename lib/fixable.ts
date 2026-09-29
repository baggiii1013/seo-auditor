// Which of the engine's checks (engine/src/checks.mjs, site.mjs, audit.mjs) a
// model may be asked to fix by editing source, without a build to prove it.
// Everything else — speed, broken links across templates, redirects — waits
// for the sandboxed agent in Phase B.
//
// `file`: one of the three documents the site does not serve. Pre-ticked,
// because they are the job this was built for. `page`: a tag in a template.

import type { Cause, Level, Report } from '../app/types.ts';

export const FIXABLE: Record<string, 'file' | 'page'> = {
  'robots-missing': 'file',
  'robots-no-sitemap': 'file',
  'no-sitemap': 'file',
  'llms-missing': 'file',
  'title-missing': 'page',
  'title-long': 'page',
  'title-short': 'page',
  'duplicate-title': 'page',
  'desc-missing': 'page',
  'desc-long': 'page',
  'desc-short': 'page',
  'duplicate-description': 'page',
  'canonical-missing': 'page',
  'canonical-multiple': 'page',
  'lang-missing': 'page',
  'charset-missing': 'page',
  'viewport-missing': 'page',
  'h1-missing': 'page',
  'h1-multiple': 'page',
  'heading-skip': 'page',
  'img-alt': 'page',
  'img-alt-filename': 'page',
  'img-alt-placeholder': 'page',
  // Open Graph text repeats the page's own title and description. An image
  // is left out: the model cannot make one, only guess which to reuse.
  'og-missing': 'page',
  'og-title-missing': 'page',
  'og-description-missing': 'page',
  'og-image-relative': 'page',
  'og-no-dimensions': 'page',
  'jsonld-invalid': 'page',
  'jsonld-no-type': 'page',
  'schema-incomplete': 'page',
};

/** One fixable check as the picker shows it and the prompt states it. */
export type Fixable = {
  id: string;
  kind: 'file' | 'page';
  title: string;
  level: Level;
  /** The engine's own sentence about it — measured facts, not advice. */
  detail: string;
  pages: string[];
};

/** The report's fixable checks, one entry per check however many causes the
 *  engine split it into. Files first, then worst first. */
export function fixables(report: Pick<Report, 'findings' | 'causes'>): Fixable[] {
  const byId = new Map<string, Fixable>();
  for (const cause of report.causes as Cause[]) {
    const kind = FIXABLE[cause.id];
    if (!kind) continue;
    const seen = byId.get(cause.id);
    if (seen) {
      seen.pages = [...new Set([...seen.pages, ...cause.pages])];
      continue;
    }
    const detail = report.findings.find((f) => f.id === cause.id)?.detail ?? '';
    byId.set(cause.id, { id: cause.id, kind, title: cause.title, level: cause.level, detail, pages: [...cause.pages] });
  }
  const rank: Record<Level, number> = { error: 0, warn: 1, note: 2, info: 2 };
  return [...byId.values()].sort(
    (a, b) => Number(a.kind === 'page') - Number(b.kind === 'page') || rank[a.level] - rank[b.level],
  );
}
