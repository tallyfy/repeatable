'use strict';

// Tool-sequence similarity: how alike is the ORDER of tools two sessions
// used? Levenshtein edit distance over tool-name symbols, normalized to
// 0..1. This is the precision gate on top of prompt similarity: two
// sessions that talk alike but act completely differently do not cluster.

const MAX_LEN = 400; // O(n*m) safety cap; longer sequences are truncated

function similarity(seqA, seqB) {
  const a = Array.isArray(seqA) ? seqA.slice(0, MAX_LEN) : [];
  const b = Array.isArray(seqB) ? seqB.slice(0, MAX_LEN) : [];
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[n];
}

module.exports = { similarity, levenshtein, MAX_LEN };
