// Minimal HTML extraction.
//
// No parser dependency on purpose: this tool should run anywhere with `npx`
// and nothing installed. The regexes below are deliberately narrow — they read
// well-formed markup produced by a static site generator, which is what this
// audits. Anything ambiguous is reported as unknown rather than guessed.


import { fingerprint } from './dupes.mjs';
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** The same, tolerant of the null a missing element gives. */
const decodeText = (s) => (s === null || s === undefined ? s : decode(String(s)).trim());

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // The typographic entities a CMS emits into link text and headings. Left
    // undecoded, "here's their page &raquo;" normalises to a phrase with the
    // word "raquo" in it, which is nobody's anchor text.
    .replace(/&(l|r)aquo;/g, (_, side) => (side === 'l' ? '«' : '»'))
    .replace(/&(m|n)dash;/g, (_, kind) => (kind === 'm' ? '—' : '–'))
    .replace(/&hellip;/g, '…')
    .replace(/&(l|r)squo;/g, "'")
    .replace(/&(l|r)dquo;/g, '"')
    // The symbols that turn up in a title bar: a price, a company name, a spec.
    .replace(/&pound;/g, '£')
    .replace(/&euro;/g, '€')
    .replace(/&yen;/g, '¥')
    .replace(/&cent;/g, '¢')
    .replace(/&copy;/g, '©')
    .replace(/&reg;/g, '®')
    .replace(/&trade;/g, '™')
    .replace(/&deg;/g, '°')
    .replace(/&times;/g, '×')
    .replace(/&middot;/g, '·')
    .replace(/&bull;/g, '•')
    .replace(/&apos;/g, "'")
    // Numeric references, decimal and hexadecimal. Hex was missing entirely,
    // and `&#x2019;` is what a CMS emits for the apostrophe in "Widget's" — so
    // a title with an apostrophe in it arrived with "&#x2019;" in the middle
    // and was five characters longer than Google measures it.
    .replace(/&#(\d+);/g, (_, code) => codePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => codePoint(Number.parseInt(code, 16)));

/** A code point, or the entity left alone. `String.fromCodePoint` throws on
 *  anything outside Unicode, and a malformed entity in one page's title is not
 *  a reason for the crawl to stop. */
function codePoint(value) {
  try {
    return String.fromCodePoint(value);
  } catch {
    return '';
  }
}

/** Attribute value from a tag string: attr(`<img alt="x">`, 'alt') → 'x'
 *
 *  The lookbehind matters, and has been widened twice by real sites:
 *
 *  - `\b` treats the hyphen in `data-src` as a boundary, so a plain
 *    word-boundary match reads a lazy-loading site's `data-src` as its `src`
 *    and reports images that are not there.
 *  - `:` and `[` introduce a framework binding — `:src`, `v-bind:src`,
 *    `x-bind:src`, `[src]` — whose value is a JavaScript expression, not a URL.
 *    allbirds.com binds `:src="(cardRefs['7205190238288']?.selectedImage…)"`,
 *    and reading those as real sources reported twenty-four of its images as
 *    404s that do not exist. */
export function attr(tag, name) {
  const start = `(?<![-:\\[\\w])${name}`;
  const m =
    tag.match(new RegExp(`${start}\\s*=\\s*"([^"]*)"`, 'i')) ??
    tag.match(new RegExp(`${start}\\s*=\\s*'([^']*)'`, 'i')) ??
    // Unquoted, which HTML permits and minifiers produce: smashingmagazine.com
    // ships `<meta name=viewport content="…">`, and reading only quoted values
    // reported nine of its pages as having no viewport at all.
    tag.match(new RegExp(`${start}\\s*=\\s*([^\\s"'\`=<>]+)`, 'i'));
  if (m) return decode(m[1]);
  // Bare boolean attribute (`<img alt>`) — present, with an empty value.
  return new RegExp(`${start}(?=[\\s/>])`, 'i').test(tag) ? '' : null;
}

/** Blank out attribute values that contain whole tags.
 *
 *  Markup inside an attribute value is a code sample, not part of the page.
 *  astro.build stores an entire Astro component in a `data-code` attribute for
 *  its copy button, and the `<img src={product.imageUrl}>` in that string was
 *  read as a real image with no alt — an error, on a site that has no such
 *  problem.
 *
 *  Deliberately narrow: the value must contain something shaped like a tag, so
 *  `title="a < b"` and `content="Tea & Cake"` are untouched. */
export const stripMarkupInAttributes = (html) =>
  html.replace(/="[^"]*<[a-z][^">]*>[^"]*"/gi, '=""');

// Japanese, Chinese and Thai do not put spaces between words, so splitting on
// whitespace counts an entire paragraph as one. The Japanese translation of a
// React docs page counted 177 against the English original's 411 — the same
// page, the same content — and was reported as thin.
//
// Counted at roughly two characters to the word, the usual working equivalence.
// It is an approximation, and deliberately a generous one: over-counting keeps
// a real page quiet, while under-counting calls it thin, and only one of those
// is a finding somebody has to argue with.
const UNSPACED_SCRIPT =
  /[぀-ヿ㐀-䶿一-鿿豈-﫿฀-๿]/g;

export function countWords(text) {
  if (!text) return 0;
  const unspaced = text.match(UNSPACED_SCRIPT)?.length ?? 0;
  const spaced = text
    .replace(UNSPACED_SCRIPT, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return spaced + Math.round(unspaced / 2);
}

export function parseHtml(rawHtml, pageUrl) {
  const html = stripMarkupInAttributes(rawHtml);

  // Elements are read from markup with <script> and <style> contents removed.
  // A script that builds HTML by concatenation — `'<li><a href="' + a.url + '">'`
  // — is code, not links on the page, and smashingmagazine.com's offline-article
  // list had nine of those reported as links to a page that does not exist.
  //
  // JSON-LD is read from `html` instead, because it lives inside a <script>.
  const markup = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const head = (markup.match(/<head[\s\S]*?<\/head>/i) ?? [''])[0];
  const mainRegion = (markup.match(/<main[\s\S]*?<\/main>/i) ?? [''])[0]
    || (markup.match(/<article[\s\S]*?<\/article>/i) ?? [''])[0]
    || null;
  const main = mainRegion || markup;

  const metas = [...markup.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const metaBy = (key, value) => {
    const tag = metas.find((t) => (attr(t, key) ?? '').toLowerCase() === value);
    return tag ? attr(tag, 'content') : null;
  };

  const links = [...markup.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const linkRel = (rel) => links.filter((t) => (attr(t, 'rel') ?? '').toLowerCase() === rel);

  // The three rel values Google reads a favicon from, and `rel` is a token
  // list, so the legacy `shortcut icon` is matched by the `icon` in it without
  // needing a rule of its own.
  const ICON_RELS = new Set(['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed']);

  const abs = (href) => {
    try {
      return new URL(href, pageUrl).toString();
    } catch {
      return null;
    }
  };

  const anchors = [...markup.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
  const mainAnchors = [...main.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
  const hrefs = (list) =>
    list
      .map((t) => attr(t, 'href'))
      .filter((h) => h && !/^(#|mailto:|tel:|javascript:|data:)/i.test(h))
      .map(abs)
      .filter(Boolean);

  const origin = new URL(pageUrl).origin;
  const internal = (list) => hrefs(list).filter((h) => h.startsWith(origin));

  // Anchors paired with the words attached to them. Google reads those words as
  // a description of the destination — they are the one signal a page gets from
  // outside itself — and until now they were parsed and thrown away.
  //
  // The name is resolved the way a browser resolves an accessible name, in
  // order, because each of these is a real way to label a link and reporting
  // any of them as unlabelled would be wrong:
  //
  //   the text inside → an image's alt → aria-label → the anchor's own title
  //
  // aria-labelledby points at another element by id. It is not followed here —
  // that means reading the rest of the document — and its mere presence counts
  // as named, since the alternative is calling a labelled link unlabelled.
  //
  // A missing </a> makes the match run to the next one, which produces text
  // where there was none. That direction is safe: it can only silence this,
  // never invent it.
  const namedAnchors = [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => {
    const tag = `<a${m[1]}>`;
    const inner = m[2];
    const img = inner.match(/<img\b[^>]*>/i)?.[0];
    const svgTitle = inner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const name =
      decode(stripTags(inner)) ||
      (img && attr(img, 'alt')) ||
      attr(tag, 'aria-label') ||
      attr(tag, 'title') ||
      (svgTitle && decode(stripTags(svgTitle))) ||
      (img && attr(img, 'title')) ||
      // A framework binding is a label the author supplied and this cannot
      // read — `:alt="item.title"`, `[ariaLabel]="…"`. The same trap that made
      // img-alt report twenty-four of allbirds.com's images as missing alt.
      (img && /[:[]alt\b/i.test(img) ? '…' : '') ||
      (/[:[](attr\.)?aria-?label\b/i.test(tag) ? '…' : '') ||
      // Labelled by something elsewhere in the document, or by a child that
      // labels itself. Not resolved, only believed.
      (attr(tag, 'aria-labelledby') !== null || /aria-label(ledby)?=/i.test(inner) ? '…' : '') ||
      '';
    return { tag, href: attr(tag, 'href'), name: name.slice(0, 300) };
  });

  // Internal only, self-links dropped: a page linking to itself says nothing
  // about anywhere, and a logo in the header does it on every page of the site.
  const anchorTexts = namedAnchors
    .filter((a) => a.href && !/^(#|mailto:|tel:|javascript:|data:)/i.test(a.href))
    .map((a) => ({ ...a, href: abs(a.href) }))
    .filter((a) => a.href?.startsWith(origin))
    .map((a) => ({ href: a.href.split('#')[0], name: a.name }))
    .filter((a) => a.href.replace(/\/$/, '') !== pageUrl.split('#')[0].replace(/\/$/, ''));

  const jsonld = [...html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => {
      try {
        return { ok: true, data: JSON.parse(m[1]) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

  const images = [...markup.matchAll(/<img\b[^>]*>/gi)].map((m) => {
    const tag = m[0];
    return {
      tag,
      src: attr(tag, 'src'),
      alt: attr(tag, 'alt'),
      width: attr(tag, 'width'),
      height: attr(tag, 'height'),
      srcset: attr(tag, 'srcset'),
      loading: attr(tag, 'loading'),
      fetchpriority: attr(tag, 'fetchpriority'),
      role: attr(tag, 'role'),
      // Captured for the two things it can contradict, never for its absence:
      // an image with no title has nothing wrong with it.
      title: attr(tag, 'title'),
      // `:alt="item.title"` is alt text the framework fills in on render. The
      // value cannot be read from here, but the author plainly provided one,
      // and calling that a missing alt is guessing wrong at error level.
      altBound: /[:[]alt\b/i.test(tag),
      // Inside a <picture> the sibling <source> may carry the srcset instead.
      inPicture: false,
    };
  });

  const pictures = [...markup.matchAll(/<picture[\s\S]*?<\/picture>/gi)].map((m) => m[0]);
  for (const img of images) {
    if (img.src && pictures.some((p) => p.includes(img.src))) img.inPicture = true;
  }

  const headings = (level) =>
    [...markup.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, 'gi'))].map((m) =>
      decode(stripTags(m[1])),
    );

  // Heading levels in document order, so a skipped level is visible — read
  // from <main> only. The footer's column headings are furniture repeated on
  // every page, not part of this page's outline, and counting them reports a
  // jump on exactly the pages whose content happens to have no h2.
  const headingLevels = [...main.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));

  const bodyText = stripTags(
    main
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' '),
  );

  // The whole document as text, for the one thing the content region cannot
  // answer: how much of this page is the page. Boilerplate is by definition
  // what lives outside <main>, so measuring it needs both.
  const wholeText = stripTags(
    markup.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '),
  );

  // --- What an answer engine reads --------------------------------------
  // An assistant quoting a page does not quote the page: it quotes a passage
  // out of it. These describe how well the markup separates one passage from
  // the next, and every one of them is counted off markup that is already
  // parsed above rather than fetched again.

  // A question with its answer attached, in the three shapes that carry one
  // without being guessed at: a <details>/<summary> pair, a heading that is a
  // question, and a <dt>/<dd> definition list. A heading counts only when
  // something follows it — a question with no answer under it is a nav label.
  const questionHeadings = [...main.matchAll(/<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/gi)]
    .map((m) => ({ text: decode(stripTags(m[1])), after: main.slice(m.index + m[0].length, m.index + m[0].length + 400) }))
    .filter((h) => /\?\s*$/.test(h.text) || /^(what|why|how|when|where|who|which|can|do|does|is|are)\b/i.test(h.text))
    .filter((h) => countWords(stripTags(h.after)) >= 10).length;

  const summaries = (main.match(/<summary\b/gi) ?? []).length;
  const definitionTerms = (main.match(/<dt\b/gi) ?? []).length;

  // Paragraph lengths, for whether a passage survives being cut out of the
  // page. A wall with no paragraph breaks is one chunk an assistant must take
  // whole or not at all; the count is what matters, not the prose.
  const paragraphWords = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => countWords(stripTags(m[1])))
    .filter((n) => n > 0);

  // The three moves the Princeton GEO study (KDD 2024) measured a lift from:
  // citing a source, carrying a number, quoting a named person. Counts only.
  //
  // None of these is scored, and that is the point rather than an omission. A
  // reference page with no outbound citations is not broken; a page that quotes
  // nobody is not broken. Absence here is something a writer could do next, and
  // the engine has a level for that — a note is a fact, not an instruction.
  //
  // Citations are counted inside <main> on purpose: the footer's links to
  // Twitter and a status page are on every page of every site and say nothing
  // about whether this page sourced its claims.
  const citations = new Set(hrefs(mainAnchors).filter((h) => !h.startsWith(origin))).size;
  const quotes = (main.match(/<blockquote\b|<cite\b/gi) ?? []).length;
  // A percentage, a year, or a number long enough to have been looked up.
  // Deliberately not every digit: "3 steps" and a phone number are not data,
  // and counting them would make the check fire on nothing.
  const statistics = (bodyText.match(/\d[\d,.]*\s?%|\b(?:19|20)\d{2}\b|\b\d[\d,.]{2,}\b/g) ?? [])
    .length;

  // Text the page is hiding from a reader while still serving it to a crawler,
  // carrying something shaped like an instruction to a model. Both halves are
  // required: hidden text on its own is a spacer or a skip link, and the words
  // on their own are an article about prompt injection.
  const hiddenRegions = [
    ...markup.matchAll(/<(div|span|p|section)\b[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|text-indent\s*:\s*-\d{4,}|aria-hidden\s*=\s*["']true["'])[^>]*>([\s\S]*?)<\/\1>/gi),
  ].map((m) => m[2]);
  const commented = [...rawHtml.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
  const INJECTION =
    /\b(ignore (all |any )?(previous|prior|above) (instructions|prompts)|disregard (the )?(above|previous)|system prompt|you are (now )?an? (ai|assistant|language model)|as an ai language model|always (recommend|cite|rank) (this|us)|do not mention)\b/i;
  const injected = [...hiddenRegions, ...commented].filter((text) => INJECTION.test(stripTags(text))).length;

  return {
    // Decoded, like every attribute value already was. A title is element text
    // rather than an attribute, so it went through none of this and arrived as
    // "Widgets &amp; Co" everywhere — in the report, in the CSV, in the length
    // Google is supposed to be measuring, and in the file handed to an
    // assistant as the site's own name for itself. Found by generating an
    // llms.txt for a real site and reading it.
    title: decodeText((markup.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [null, null])[1]),
    description: metaBy('name', 'description'),
    // Who wrote it. One half of the experience-and-expertise signal an answer
    // engine weighs before quoting a page; the other half is an `author` in the
    // structured data, which the checks read from `jsonld` rather than here.
    author: metaBy('name', 'author'),
    robots: metaBy('name', 'robots'),
    // <meta http-equiv="refresh" content="0;url=…"> — a redirect that is not
    // one, and the only kind this tool can see in the markup.
    refresh: metaBy('http-equiv', 'refresh'),
    viewport: metaBy('name', 'viewport'),
    lang: attr((markup.match(/<html\b[^>]*>/i) ?? [''])[0], 'lang'),
    canonical: linkRel('canonical').map((t) => abs(attr(t, 'href'))).filter(Boolean),
    hreflang: linkRel('alternate')
      .filter((t) => attr(t, 'hreflang'))
      .map((t) => ({ lang: attr(t, 'hreflang'), href: abs(attr(t, 'href')) })),
    og: Object.fromEntries(
      metas
        .filter((t) => (attr(t, 'property') ?? '').startsWith('og:'))
        .map((t) => [attr(t, 'property'), attr(t, 'content')]),
    ),
    twitter: Object.fromEntries(
      metas
        .filter((t) => (attr(t, 'name') ?? '').startsWith('twitter:'))
        .map((t) => [attr(t, 'name'), attr(t, 'content')]),
    ),
    h1: headings(1),
    h2: headings(2),
    headingLevels,
    charset:
      metaBy('charset', undefined) ??
      (metas.some((t) => attr(t, 'charset') !== null)
        ? attr(metas.find((t) => attr(t, 'charset') !== null), 'charset')
        : /charset=/i.test(head)
          ? 'declared'
          : null),
    images,
    // Declared favicons, in the order a search engine would prefer them: the
    // plain `icon` first, then the iOS ones. Google looks for these on the
    // home page and draws the result beside every listing the site owns.
    icons: links
      .map((tag) => ({
        rel: (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean),
        href: abs(attr(tag, 'href')),
      }))
      .filter((icon) => icon.href && icon.rel.some((r) => ICON_RELS.has(r)))
      .sort((a, b) => Number(b.rel.includes('icon')) - Number(a.rel.includes('icon')))
      .map((icon) => icon.href)
      .filter((href, i, all) => all.indexOf(href) === i),
    jsonld,
    links: {
      internal: [...new Set(internal(anchors))],
      inMain: [...new Set(internal(mainAnchors))],
      external: [...new Set(hrefs(anchors).filter((h) => !h.startsWith(origin)))],
      // Internal links the page tells Google not to follow. `rel` carries a
      // space-separated list, so nofollow travels with noopener and friends.
      //
      // Fragments are stripped and self-links dropped: WordPress marks its
      // comment-reply links rel="nofollow" pointing at #respond on the page
      // they are already on, and every article on a WordPress site would report
      // a withheld path that leads nowhere new.
      // Every internal link with the words attached to it — see above.
      anchorTexts,
      nofollowInternal: [
        ...new Set(
          internal(anchors.filter((t) => /(^|\s)nofollow(\s|$)/i.test(attr(t, 'rel') ?? '')))
            .map((h) => h.split('#')[0])
            .filter((h) => h.replace(/\/$/, '') !== pageUrl.split('#')[0].replace(/\/$/, '')),
        ),
      ],
    },
    words: countWords(bodyText),
    // What an answer engine gets when it reads this page. Counts only — the
    // checks decide what they mean, and nothing here is scored on its own.
    answerable: {
      questions: questionHeadings,
      summaries,
      definitionTerms,
      paragraphs: paragraphWords.length,
      longestParagraph: paragraphWords.length ? Math.max(...paragraphWords) : 0,
      injected,
      citations,
      quotes,
      statistics,
      // The share of the page that is the page. Null when the page never
      // marked a content region: without <main> the two texts are the same
      // string and the ratio would be 1 on every page of every site.
      contentRatio: mainRegion && countWords(wholeText)
        ? countWords(bodyText) / countWords(wholeText)
        : null,
    },
    // A sketch of the content, for finding pages that are the same page again.
    // Only when the page marked its content region: without `<main>` or
    // `<article>` the text above is the whole document, navigation and footer
    // included, and every page of a small site would look like every other.
    // Saying "not compared" is the honest answer; guessing is not.
    fingerprint: mainRegion ? fingerprint(bodyText) : null,
  };
}

/** URLs from a sitemap or sitemap index. Returns {urls, sitemaps, entries}.
 *
 *  `entries` pairs each <loc> with its own <lastmod>, read from inside the
 *  <url> block so a date cannot drift onto a neighbouring URL. It is additional
 *  rather than a replacement: `urls` stays a plain list of strings, because
 *  every caller wants exactly that and changing it would ripple through
 *  discovery for no gain. */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  const isIndex = /<sitemapindex/i.test(xml);
  if (isIndex) return { urls: [], sitemaps: locs, entries: [] };

  const entries = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)]
    .map((m) => ({
      loc: decode(m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1] ?? ''),
      lastmod: m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1] ?? null,
    }))
    .filter((entry) => entry.loc);

  return { urls: locs, sitemaps: [], entries };
}

/**
 * What a response body actually is, when the server has already claimed it is
 * HTML. Returns `null` for anything that might be HTML, and a noun for the
 * cases that provably are not.
 *
 * Deliberately conservative — it answers on positive evidence only. A fragment
 * with no `<html>` wrapper is still HTML; a page behind a byte-order mark is
 * still HTML; and XHTML opens with `<?xml` and *is* HTML, which is why the
 * markers are checked before the prologue. Guessing wrong here would silence
 * every check on a real page, which is a worse failure than the noise it is
 * meant to remove.
 */
export function bodyKind(body) {
  if (typeof body !== 'string') return null;
  const head = body.replace(/^﻿/, '').trimStart().slice(0, 2048);
  if (!head) return null;
  // Any of these and it is HTML, whatever it opened with.
  if (/<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(head)) return null;
  if (/^%PDF-/.test(head)) return 'a PDF';
  if (/^<\?xml[\s?]/i.test(head) || /^<(urlset|sitemapindex|rss|feed|kml|svg)[\s>]/i.test(head)) return 'XML';
  if (/^[[{]/.test(head)) {
    try {
      JSON.parse(body);
      return 'JSON';
    } catch {
      return null;
    }
  }
  return null;
}
