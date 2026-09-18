// How ready a site is for the engines that answer instead of linking.
//
// The hundred-point score in `score.mjs` is a deduction sheet, and it prices
// every check the same way on purpose. That makes it the wrong instrument for
// this question. Most of what decides whether an assistant quotes a page is
// not a fault — a page with no statistics in it is not a broken page — so the
// checklist scores almost none of it, and the one number that comes out the
// other end says nothing about answer engines at all.
//
// So: a second, smaller sheet, kept deliberately separate.
//
//   * It never touches `score`. Nothing here adds or removes a point from the
//     hundred, and `score.ai` can be deleted from the payload without moving
//     the grade. The engine's promise that an opportunity costs nothing still
//     holds.
//   * It is a share of what applied, not a deduction from a fixed total. Four
//     checks cannot take 100 points off a 100-point sheet, so a pillar scored
//     that way could never fall below 72 and would read as a pass on a site
//     that does none of this. Each pillar is scored out of what it was in a
//     position to ask.
//   * A signal that could not run is in neither half of that share. Same rule
//     as the checklist: a check that was never asked is not a check that
//     passed, and rolling it in as a pass is how a one-page crawl comes out at
//     100.
//
// Three pillars, because they fail independently and are fixed by different
// people. Access is a robots.txt question and is answered by whoever owns the
// domain. AEO is a page-structure question and is answered by whoever writes
// the template. GEO is a what-is-on-the-page question and is answered by
// whoever writes the words.

import { gradeOf } from './score.mjs';

/** The pillars, in the order a reader should meet them: let in, then found,
 *  then worth quoting. A pillar with no applicable signal is absent from the
 *  output rather than shown at 100 — the same refusal the areas make. */
export const PILLARS = [
  {
    key: 'access',
    name: 'Access',
    blurb: 'Whether an assistant is allowed to read the site at all, and whether the site says so consistently.',
  },
  {
    key: 'aeo',
    name: 'Answer engines',
    blurb: 'Whether there is a passage an assistant can lift whole and attribute, rather than a page it has to summarise itself.',
  },
  {
    key: 'geo',
    name: 'Generative engines',
    blurb: 'Whether the page carries what a model weighs when it decides which of two sources to cite.',
  },
];

// Weights are within a pillar and mean nothing across one — a pillar is scored
// out of its own applicable total, so 12 here is "twice the one worth 6", not
// "12 points of the hundred".
//
// The GEO weights follow the effect sizes the checks themselves quote, from
// the Princeton GEO study (KDD 2024, 10k queries against Perplexity):
// citations were the largest single lift, statistics second, quotes third.
// They are an ordering taken from somebody else's measurement, not a
// measurement of our own, which is why they are written down here next to the
// sentence that says where they came from.
//
// `needs` mirrors `score.mjs` — the key in `meta.applicable` that has to be
// true for the signal to have been asked at all.
export const SIGNALS = [
  // --- Access ---------------------------------------------------------------
  // The two robots signals are on the hundred-point sheet as well. That is not
  // double counting: the two sheets are separate scales measuring different
  // questions, and a robots.txt that blocks everything is the single most
  // important fact about whether an assistant can read this site. Leaving it
  // out to avoid appearing twice would have scored access off llms.txt alone.
  {
    id: 'robots-blocks-all', pillar: 'access', weight: 16, scope: 'site',
    label: 'robots.txt does not block the site',
    why: 'A blanket Disallow is the end of the conversation. Nothing below it matters, because nothing gets read.',
    fix: 'Narrow the Disallow to the paths that actually needed it.',
  },
  {
    id: 'robots-missing', pillar: 'access', weight: 4, scope: 'site',
    label: 'The site serves a robots.txt',
    why: 'Most assistants fetch it before anything else. A missing one is not a block, but it is the file where a site gets to say which crawlers it wants.',
    fix: 'Serve a robots.txt, even one that allows everything and names the sitemap.',
  },
  {
    id: 'ai-crawler-conflict', pillar: 'access', weight: 12, scope: 'site', needs: 'llmsTxt',
    label: 'robots.txt and llms.txt agree',
    why: 'A site that publishes llms.txt is addressing assistants directly. When robots.txt then blocks the ones it welcomes, the two files disagree and the crawler obeys robots.txt.',
    fix: 'Decide which assistants may read the site, then say the same thing in both files.',
  },
  {
    id: 'llms-missing', pillar: 'access', weight: 4, scope: 'site',
    label: 'The site publishes an llms.txt',
    why: 'llms.txt is how a site tells an assistant which pages are the ones worth reading. Without it an assistant works from the sitemap and the navigation, like a crawler.',
    fix: 'Write /llms.txt listing the pages you would want quoted. `--write-llms` generates a first draft from this crawl.',
  },
  {
    // Not scored, and it is here so that it is visible rather than to be
    // counted. Disallowing an AI crawler is a licensing decision a publisher
    // is entitled to make, and a readiness number that docked points for it
    // would be grading somebody's business model.
    id: 'ai-crawler-blocked', pillar: 'access', weight: 0, scope: 'site',
    label: 'No AI crawler is disallowed',
    why: 'Blocking GPTBot or ClaudeBot is a deliberate choice and costs nothing here. It is reported because it decides the ceiling on everything below: a crawler that is refused never reads the page it would have quoted.',
    fix: 'Nothing, unless the block was not intended.',
  },

  // --- Answer engines -------------------------------------------------------
  {
    id: 'aeo-no-answer-block', pillar: 'aeo', weight: 12, scope: 'page', needs: 'substantial',
    label: 'Pages answer a question in a liftable passage',
    why: 'An assistant quotes a passage, not a page. With no question-shaped heading answered underneath it, it has to summarise the page and attribute the summary to itself.',
    fix: 'Give the page a heading that asks what a reader would ask, and answer it in the paragraph underneath.',
  },
  {
    id: 'aeo-nosnippet', pillar: 'aeo', weight: 10, scope: 'page',
    label: 'No page forbids its own snippet',
    why: 'nosnippet, max-snippet:0 and data-nosnippet withhold the exact text an answer engine would have quoted. The page can still be read; it cannot be repeated.',
    fix: 'Drop the directive on pages you want quoted, or narrow it to the element that needed it.',
  },
  {
    id: 'aeo-boilerplate-heavy', pillar: 'aeo', weight: 8, scope: 'page', needs: 'contentRegions',
    label: 'Pages are mostly their own content',
    why: 'When most of the words are navigation, footer and chrome, an assistant weighing what the page is about is reading mostly furniture.',
    fix: 'Put the content in <main> and keep the furniture out of it.',
  },
  {
    id: 'aeo-no-author', pillar: 'aeo', weight: 6, scope: 'page', needs: 'substantial',
    label: 'Pages name an author',
    why: 'Experience and expertise are the first two letters of E-E-A-T, and neither can be read off a page that names nobody.',
    fix: 'Name the author in the structured data, not only in the byline image.',
  },

  // --- Generative engines ---------------------------------------------------
  {
    id: 'geo-prompt-injection', pillar: 'geo', weight: 16, scope: 'page',
    label: 'No hidden text addresses the model',
    why: 'Text hidden from the reader and served to the crawler, shaped like an instruction, is read as manipulation — and it is the page, not the passage, that stops being trusted.',
    fix: 'Remove it. If it arrived with a plugin or a template, it is worth knowing it is being served.',
  },
  {
    id: 'geo-no-citations', pillar: 'geo', weight: 12, scope: 'page', needs: 'substantial',
    label: 'Pages cite a source',
    why: 'The largest single effect in the Princeton GEO study (+30–115% visibility). An assistant weighing two pages prefers the one that shows its work.',
    fix: 'Link out from inside the content to the sources the claims rest on.',
  },
  {
    id: 'geo-no-statistics', pillar: 'geo', weight: 8, scope: 'page', needs: 'substantial',
    label: 'Pages carry concrete numbers',
    why: 'Second-largest effect in the same study (+40%). A number is the part of a page an assistant can quote as a fact rather than paraphrase as an opinion.',
    fix: 'Give the figure, the percentage or the year rather than "significantly".',
  },
  {
    id: 'geo-no-quotes', pillar: 'geo', weight: 6, scope: 'page', needs: 'substantial',
    label: 'Pages quote someone',
    why: 'An attributed quote — name, role, year — was worth +30–40% in the same study, and is the cheapest expertise signal a page can carry.',
    fix: 'Quote a named person in a <blockquote> with a <cite>.',
  },
  {
    id: 'geo-chunk-wall', pillar: 'geo', weight: 6, scope: 'page', needs: 'substantial',
    label: 'No passage is too long to quote',
    why: 'Retrieval splits a page into passages and quotes one. A paragraph running to the length of a page is quoted whole or not at all.',
    fix: 'Break the passage at the points where it changes subject.',
  },
];

/** One decimal, and never a bare zero for something that did cost. The same
 *  rounding `score.mjs` uses, repeated rather than exported across, because a
 *  shared three-line helper is not worth the import cycle it would create. */
const round = (n) => (n > 0 && n < 0.1 ? 0.1 : Math.round(n * 10) / 10);

/** Why a signal was not asked, in a sentence. Keyed by the same `needs` values
 *  `score.mjs` uses, and worded for this sheet rather than that one. */
const WHY_SKIPPED = {
  llmsTxt: 'The site serves no llms.txt, so there is nothing for robots.txt to contradict.',
  substantial: 'No page has enough content for an assistant to quote a passage out of.',
  contentRegions: 'No page marks its content region, so the page cannot be told from the furniture.',
};

/**
 * Score the answer- and generative-engine readiness of a run.
 *
 * Takes the same three arguments `scoreRun` does and shares its rules: kept
 * findings only, distinct pages per signal, and a signal that did not apply is
 * in neither the numerator nor the denominator.
 *
 * Returns `null` when nothing applied — a run with no crawlable page has no
 * share of this sheet either, and a 0 would read as a verdict rather than as
 * an absence.
 */
export function aiReadiness(findings, { pages = 0, applicable = {} } = {}) {
  if (!pages) return null;

  const byId = new Map(SIGNALS.map((s) => [s.id, s]));
  // Distinct pages per signal, for the same reason the checklist counts them
  // that way: one page with four uncited claims is one page missing citations.
  const hits = new Map();
  for (const finding of findings) {
    if (!byId.has(finding.id)) continue;
    const seen = hits.get(finding.id) ?? new Set();
    seen.add(finding.url ?? '');
    hits.set(finding.id, seen);
  }

  const rows = SIGNALS.map((signal) => {
    const on = hits.get(signal.id)?.size ?? 0;
    const asked = on > 0 || !signal.needs || applicable[signal.needs] === true;
    if (!asked) {
      // `whySkipped`, not `why`. The signal already carries a `why` meaning
      // "why this matters"; putting the skip reason on the same key made a row
      // whose one field meant the opposite thing depending on its state.
      return { ...signal, state: 'skipped', pages: 0, whySkipped: WHY_SKIPPED[signal.needs] };
    }
    const spread = signal.scope === 'site' ? (on ? 1 : 0) : Math.min(1, on / pages);
    return {
      ...signal,
      state: on ? 'failed' : 'passed',
      pages: on,
      // The share of the crawl this signal is missing from, kept on the row so
      // a client can say "on 12 of 40 pages" without dividing anything itself.
      spread: round(spread * 100) / 100,
      cost: round(signal.weight * spread),
    };
  });

  const pillars = [];
  for (const pillar of PILLARS) {
    const mine = rows.filter((r) => r.pillar === pillar.key);
    const asked = mine.filter((r) => r.state !== 'skipped' && r.weight > 0);
    // Nothing this pillar could ask about. Absent rather than shown at 100,
    // which would be a clean bill of health for a question never put.
    if (!asked.length) continue;
    const possible = asked.reduce((sum, r) => sum + r.weight, 0);
    const spent = asked.reduce((sum, r) => sum + r.cost, 0);
    const score = Math.max(0, Math.round(100 * (1 - spent / possible)));
    // What each signal is worth of this pillar, and what fixing it would hand
    // back. Written onto the row rather than left for a client to divide,
    // because two clients dividing it differently is how a report starts
    // disagreeing with itself. Only the asked rows carry a share: a skipped
    // signal is not in the denominator, so it has none.
    for (const row of mine) {
      if (row.state === 'skipped' || !row.weight) continue;
      row.sharePct = Math.round((100 * row.weight) / possible);
      row.recoverable = Math.round((100 * row.cost) / possible);
    }
    pillars.push({
      ...pillar,
      score,
      grade: gradeOf(score),
      possible,
      lost: round(spent),
      passed: asked.filter((r) => r.state === 'passed').length,
      failed: asked.filter((r) => r.state === 'failed').length,
      skipped: mine.filter((r) => r.state === 'skipped').length,
      // How much of the pillar the run was in a position to ask about. A
      // pillar scored out of one applicable signal is a 100 that means "we
      // could not look", and a client showing it in green without this is
      // making a claim the run did not earn.
      coverage: Math.round((100 * asked.length) / (asked.length + mine.filter((r) => r.state === 'skipped').length)),
      signals: mine,
    });
  }

  if (!pillars.length) return null;

  // The headline is weighted by what each pillar was able to ask, so a pillar
  // with one applicable signal does not count for as much as one with five.
  // An unweighted mean of three pillars would let a single site-wide check
  // outvote every page on the site.
  const possible = pillars.reduce((sum, p) => sum + p.possible, 0);
  const lost = pillars.reduce((sum, p) => sum + p.lost, 0);
  const score = Math.max(0, Math.round(100 * (1 - lost / possible)));

  return { score, grade: gradeOf(score), possible, lost: round(lost), pillars };
}
