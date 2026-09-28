'use strict';

// A child process gets only the variables it needs (#13).
//
// Anthropic's directory validator held the plugin because scripts/enqueue.js
// started the worker with a copy of the whole environment. These tests keep
// both spawn sites on worker/env.js and prove the helper drops what it must.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { workerEnv, KEEP } = require('../worker/env');

const ROOT = path.join(__dirname, '..');
const SPAWN_SITES = ['scripts/enqueue.js', 'worker/cli.js'];

test('workerEnv drops a variable it was not told to keep', () => {
  const planted = 'RPT_PLANTED_' + process.pid;
  process.env[planted] = 'must-not-reach-the-child';
  try {
    const env = workerEnv({ REPEATABLE_DATA_DIR: '/tmp/x' });
    assert.strictEqual(env[planted], undefined);
    assert.strictEqual(env.REPEATABLE_DATA_DIR, '/tmp/x');
  } finally {
    delete process.env[planted];
  }
});

test('workerEnv keeps what the worker reads', () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = '/tmp/rpt-config';
  try {
    const env = workerEnv();
    assert.strictEqual(env.CLAUDE_CONFIG_DIR, '/tmp/rpt-config');
    if (process.env.PATH !== undefined) assert.strictEqual(env.PATH, process.env.PATH);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('every variable the plugin reads is on the keep list', () => {
  // Discovered from the source, so a new variable the worker starts reading
  // fails here until it is added to KEEP.
  const read = new Set();
  for (const dir of ['worker', 'scripts']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (!name.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(ROOT, dir, name), 'utf8');
      for (const m of src.matchAll(/process\.env\.([A-Z_]+)/g)) read.add(m[1]);
    }
  }
  assert.ok(read.size >= 4, 'expected at least 4 variables read, found ' + read.size);
  // REPEATABLE_NO_SPAWN is a test switch read by the parent only.
  const missing = [...read].filter((k) => !KEEP.includes(k) && k !== 'REPEATABLE_NO_SPAWN');
  assert.deepStrictEqual(missing, []);
});

function shippedJs() {
  // Tests ship inside the plugin too, and the directory validator reads
  // them, so every .js folder the plugin carries is in scope.
  const out = [];
  for (const dir of ['scripts', 'worker', 'test', 'test/helpers']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (name.endsWith('.js')) out.push(path.join(dir, name));
    }
  }
  return out;
}

test('no shipped file hands a child the whole environment', () => {
  // Built from pieces so this file does not contain the shapes it hunts.
  const whole = [
    'env: process' + '.env',
    'Object.assign({}, process' + '.env',
    '...process' + '.env'
  ];
  const files = shippedJs();
  assert.ok(files.length >= 15, 'expected at least 15 .js files, found ' + files.length);
  const offenders = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const shape of whole) if (src.includes(shape)) offenders.push(rel + ': ' + shape);
  }
  assert.deepStrictEqual(offenders, []);
  for (const rel of SPAWN_SITES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(src.includes('workerEnv('), rel + ' must build its child env with workerEnv');
  }
});

test('the whole-environment check can see the shape it hunts', () => {
  const sample = 'spawn(x, [], { env: process' + '.env })';
  assert.ok(sample.includes('env: process' + '.env'));
});
