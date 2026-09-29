// A line diff for the fix review — what the model changed, shown the way a
// pull request will show it.
//
// Common prefix and suffix first, which is almost all of a file a fix touches,
// then a longest-common-subsequence over what is left.
//
// ponytail: the LCS table is n×m. Past a few million cells the middle is shown
// as removed-then-added instead; switch to Myers' O(ND) if that shows up.

export type DiffLine = { op: ' ' | '+' | '-'; text: string } | { op: '…'; count: number };

const MAX_CELLS = 4_000_000;

// The newline that ends a file ends its last line; it does not start another.
// ponytail: so a file gaining or losing only that newline diffs as unchanged.
const split = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

export function diffLines(before: string, after: string, context = 3): DiffLine[] {
  const a = split(before);
  const b = split(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;

  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);
  const middle: DiffLine[] = [];
  if (x.length * y.length > MAX_CELLS) {
    middle.push(...x.map((text) => ({ op: '-' as const, text })), ...y.map((text) => ({ op: '+' as const, text })));
  } else {
    // lcs[i][j]: the longest common run of x[i..] and y[j..], in one flat array.
    const w = y.length + 1;
    const lcs = new Uint32Array((x.length + 1) * w);
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        middle.push({ op: ' ', text: x[i++] });
        j++;
      } else if (i < x.length && (j === y.length || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
        // Removals before additions on a tie, the order a pull request shows.
        middle.push({ op: '-', text: x[i++] });
      } else {
        middle.push({ op: '+', text: y[j++] });
      }
    }
  }

  const all: DiffLine[] = [
    ...a.slice(0, start).map((text) => ({ op: ' ' as const, text })),
    ...middle,
    ...a.slice(a.length - end).map((text) => ({ op: ' ' as const, text })),
  ];

  // Unchanged runs longer than the context on both sides fold into a count.
  const near = all.map((line, k) =>
    all.slice(Math.max(0, k - context), k + context + 1).some((other) => other.op !== ' '),
  );
  const out: DiffLine[] = [];
  for (let k = 0; k < all.length; k++) {
    if (near[k]) {
      out.push(all[k]);
      continue;
    }
    const last = out.at(-1);
    if (last?.op === '…') last.count++;
    else out.push({ op: '…', count: 1 });
  }
  return out;
}
