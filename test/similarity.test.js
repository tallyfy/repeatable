'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { normalizePrompt, shingles } = require('../worker/normalize');
const minhash = require('../worker/minhash');
const toolseq = require('../worker/toolseq');

test('normalization converges varying inputs of the same process', () => {
  const a = normalizePrompt('Draft release notes for v2.14.7 from /home/u/repo/CHANGELOG.md due 2026-07-22');
  const b = normalizePrompt('Draft release notes for v2.15.0 from C:\\repo\\CHANGELOG.md due 2026-07-29');
  assert.strictEqual(a, b);
});

test('normalization class tokens', () => {
  const n = normalizePrompt('email bob@example.com about https://example.com/x and id 123e4567-e89b-12d3-a456-426614174000 total 12345');
  assert.ok(n.includes('EMAIL'));
  assert.ok(n.includes('URL'));
  assert.ok(n.includes('ID'));
  assert.ok(n.includes('NUM'));
});

test('shingles: unique word 3-grams, short-text fallback', () => {
  assert.deepStrictEqual(shingles('a b c d', 3), ['a b c', 'b c d']);
  assert.deepStrictEqual(shingles('a b', 3), ['a b']);
  assert.deepStrictEqual(shingles('', 3), []);
});

test('minhash: deterministic signatures', () => {
  const s = shingles(normalizePrompt('draft the weekly release notes and publish them'), 3);
  const sig1 = minhash.signature(s);
  const sig2 = minhash.signature(s.slice());
  assert.deepStrictEqual(sig1, sig2);
  assert.strictEqual(sig1.length, minhash.NUM_PERMS);
});

test('minhash: similar texts score high, unrelated low', () => {
  const mk = (t) => minhash.signature(shingles(normalizePrompt(t), 3));
  const a = mk('Draft the weekly release notes for v2.14.1 using CHANGELOG.md and summarize the merged changes | Publish the notes to the stable channel and tag version 2.14.1');
  const b = mk('Draft the weekly release notes for v2.15.0 using CHANGES.md and summarize the merged changes | Publish the notes to the beta channel and tag version 2.15.0');
  const c = mk('Investigate the flaky login test and explain the root cause in detail');
  const simAB = minhash.estJaccard(a, b);
  const simAC = minhash.estJaccard(a, c);
  assert.ok(simAB > 0.5, 'same process should exceed 0.5, got ' + simAB);
  assert.ok(simAC < 0.2, 'unrelated should stay below 0.2, got ' + simAC);
});

test('minhash: null signature for empty input', () => {
  assert.strictEqual(minhash.signature([]), null);
  assert.strictEqual(minhash.estJaccard(null, null), 0);
});

test('bandKeys: equal signatures share all keys, unrelated share few', () => {
  const mk = (t) => minhash.signature(shingles(normalizePrompt(t), 3));
  const a = mk('one two three four five six seven eight');
  const b = mk('one two three four five six seven eight');
  const c = mk('totally different content about databases and indexes');
  assert.deepStrictEqual(minhash.bandKeys(a), minhash.bandKeys(b));
  const setA = new Set(minhash.bandKeys(a));
  const shared = minhash.bandKeys(c).filter((k) => setA.has(k)).length;
  assert.ok(shared <= 2, 'unrelated texts should share almost no bands, shared ' + shared);
});

test('toolseq similarity: identity, edits, and empty cases', () => {
  assert.strictEqual(toolseq.similarity(['Read', 'Bash', 'Write'], ['Read', 'Bash', 'Write']), 1);
  const near = toolseq.similarity(['Read', 'Bash', 'Write'], ['Read', 'Grep', 'Bash', 'Write']);
  assert.ok(near >= 0.7 && near < 1, 'one insertion should stay high, got ' + near);
  const far = toolseq.similarity(['Read', 'Bash', 'Write'], ['Grep', 'Glob', 'Task', 'WebFetch', 'Edit']);
  assert.ok(far < 0.3, 'disjoint sequences should be low, got ' + far);
  assert.strictEqual(toolseq.similarity([], []), 1);
  assert.strictEqual(toolseq.similarity(['Read'], []), 0);
});
