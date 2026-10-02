// Its own file so the report (a client component) can compute the same key the
// store writes under, without importing the Postgres driver into the browser bundle.

/** The key a repository is linked under.
 *
 *  `meta.origin` arrives as whatever was typed into the audit form —
 *  `https://acme.com`, `https://acme.com/`, `HTTPS://Acme.com/pricing` — and a
 *  link made under one spelling has to be found by the others. Normalising in
 *  one exported function rather than at each call site is the whole of what
 *  keeps the read and the write agreeing about which row they mean. */
export function siteKey(origin: string): string {
  try {
    return new URL(origin).origin.toLowerCase();
  } catch {
    return origin.trim().toLowerCase();
  }
}
