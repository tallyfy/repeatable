'use strict';

// Prompt normalization for similarity. The goal: two runs of the same
// process with different inputs (different file names, ids, dates,
// amounts) should normalize to nearly identical text. This feeds MinHash;
// it is NOT what gets shown to users (prompts are stored redacted but
// otherwise verbatim).

function normalizePrompt(text) {
  if (typeof text !== 'string') return '';
  let t = text.toLowerCase();

  // Redaction placeholders collapse to a class token
  t = t.replace(/\[redacted\]/g, ' SECRET ');

  // URLs before paths (a URL contains slashes)
  t = t.replace(/https?:\/\/[^\s"'<>)]+/g, ' URL ');

  // Emails
  t = t.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, ' EMAIL ');

  // UUIDs
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, ' ID ');

  // Long hex runs (git SHAs, hashes)
  t = t.replace(/\b[0-9a-f]{8,}\b/g, ' ID ');

  // Windows paths
  t = t.replace(/\b[a-z]:\\[^\s"'<>|]+/g, ' PATH ');

  // Unix paths: absolute, ./relative, ../relative, ~/home (two or more segments)
  t = t.replace(/(?:~|\.{1,2})?\/[\w.@%+-]+(?:\/[\w.@%+-]+)+\/?/g, ' PATH ');

  // Bare filenames with extensions
  t = t.replace(/\b[\w-]+\.(?:md|txt|json|jsonl|csv|tsv|pdf|docx?|xlsx?|png|jpe?g|gif|svg|ts|js|mjs|cjs|py|rb|go|rs|java|php|html?|css|ya?ml|toml|sh|sql|log|zip|tar|gz)\b/g, ' FILE ');

  // Dates (ISO-ish and slashed)
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' DATE ');
  t = t.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' DATE ');

  // All standalone digit runs (versions, amounts, counts, ids). Aggressive
  // on purpose: the number is exactly what varies between runs of the same
  // process.
  t = t.replace(/\b\d+\b/g, ' NUM ');

  // Everything non-alphanumeric becomes a space; collapse
  t = t.replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

// Word k-shingles over normalized text. Returns an array of unique
// shingle strings. Short texts fall back to a single shingle so tiny
// prompts still produce a signature.
function shingles(normalizedText, k) {
  const kk = k || 3;
  const words = normalizedText.split(' ').filter(Boolean);
  if (words.length === 0) return [];
  if (words.length < kk) return [words.join(' ')];
  const out = new Set();
  for (let i = 0; i + kk <= words.length; i++) {
    out.add(words.slice(i, i + kk).join(' '));
  }
  return Array.from(out);
}

module.exports = { normalizePrompt, shingles };
