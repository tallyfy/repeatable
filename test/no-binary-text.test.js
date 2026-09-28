'use strict';

// Every shipped text file stays text (#13).
//
// Anthropic's directory validator could not inspect worker/cluster.js because
// three string literals held a raw NUL byte, so it read the file as binary and
// held the plugin for review. The separator is now written as an escape; this
// test fails if a raw NUL comes back in any shipped text file.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf', '.otf']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && !BINARY_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function hasNul(buf) {
  return buf.includes(0);
}

test('no shipped text file contains a NUL byte', () => {
  const files = walk(ROOT, []);
  assert.ok(files.length >= 30, 'expected at least 30 files, found ' + files.length);
  const offenders = files
    .filter((f) => hasNul(fs.readFileSync(f)))
    .map((f) => path.relative(ROOT, f));
  assert.deepStrictEqual(offenders, []);
});

test('the NUL check sees a planted NUL', () => {
  assert.strictEqual(hasNul(Buffer.from([0x61, 0x00, 0x62])), true);
  assert.strictEqual(hasNul(Buffer.from('plain text')), false);
});
