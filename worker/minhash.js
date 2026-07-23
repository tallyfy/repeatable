'use strict';

// MinHash signatures over shingle sets, plus LSH banding for candidate
// pair generation. Pure arithmetic, fully deterministic (fixed seeds), no
// dependencies. This is the "zero LLM" heart of detection.

const NUM_PERMS = 128;
const BANDS = 32;
const ROWS = 4; // BANDS * ROWS === NUM_PERMS

// Deterministic seed table via a fixed LCG. Never change these constants:
// stored signatures would stop being comparable across versions (a schema
// bump + full re-index would be required).
const SEEDS = (() => {
  const seeds = new Array(NUM_PERMS);
  let state = 0x9e3779b9 >>> 0;
  for (let i = 0; i < NUM_PERMS; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    seeds[i] = state;
  }
  return seeds;
})();

// FNV-1a 32-bit string hash
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 32-bit integer finalizer (xorshift-multiply mix)
function mix32(x) {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return x >>> 0;
}

// Signature: for each of 128 seeded hash functions, the minimum hash over
// all shingles. Returns null for an empty shingle set.
function signature(shingleList) {
  if (!shingleList || shingleList.length === 0) return null;
  const base = shingleList.map(fnv1a);
  const sig = new Array(NUM_PERMS);
  for (let i = 0; i < NUM_PERMS; i++) {
    const seed = SEEDS[i];
    let min = 0xffffffff;
    for (let j = 0; j < base.length; j++) {
      const h = mix32(base[j] ^ seed);
      if (h < min) min = h;
    }
    sig[i] = min;
  }
  return sig;
}

function estJaccard(sigA, sigB) {
  if (!sigA || !sigB || sigA.length !== sigB.length) return 0;
  let eq = 0;
  for (let i = 0; i < sigA.length; i++) {
    if (sigA[i] === sigB[i]) eq++;
  }
  return eq / sigA.length;
}

// LSH band keys: sessions sharing any band key are candidate pairs.
// 32 bands x 4 rows is tuned for recall around Jaccard 0.5
// (P(candidate) = 1 - (1 - s^4)^32; s=0.5 -> ~0.87, s=0.3 -> ~0.23).
function bandKeys(sig) {
  if (!sig) return [];
  const keys = new Array(BANDS);
  for (let b = 0; b < BANDS; b++) {
    let h = 0x811c9dc5;
    for (let r = 0; r < ROWS; r++) {
      const v = sig[b * ROWS + r];
      h ^= v & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
    }
    keys[b] = b + ':' + (h >>> 0).toString(36);
  }
  return keys;
}

module.exports = { NUM_PERMS, BANDS, ROWS, signature, estJaccard, bandKeys, fnv1a, mix32 };
