'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { workerEnv } = require('../worker/env');

const ENQUEUE = path.join(__dirname, '..', 'scripts', 'enqueue.js');

function runEnqueue(input, dataDir) {
  return spawnSync(process.execPath, [ENQUEUE], {
    input,
    encoding: 'utf8',
    env: workerEnv({
      REPEATABLE_DATA_DIR: dataDir,
      REPEATABLE_NO_SPAWN: '1'
    }),
    timeout: 10000
  });
}

test('valid payload writes a queue entry and exits 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-enq-'));
  const payload = {
    session_id: 'abc-123',
    transcript_path: '/fake/transcript.jsonl',
    cwd: '/fake/project',
    reason: 'other',
    hook_event_name: 'SessionEnd'
  };
  const res = runEnqueue(JSON.stringify(payload), dir);
  assert.strictEqual(res.status, 0);
  const entry = JSON.parse(fs.readFileSync(path.join(dir, 'queue', 'abc-123.json'), 'utf8'));
  assert.strictEqual(entry.session_id, 'abc-123');
  assert.strictEqual(entry.transcript_path, '/fake/transcript.jsonl');
  assert.strictEqual(entry.cwd, '/fake/project');
  assert.strictEqual(entry.reason, 'other');
  assert.ok(entry.enqueued_at);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('malformed stdin still exits 0 and writes a fallback entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-enq-'));
  const res = runEnqueue('this is not json', dir);
  assert.strictEqual(res.status, 0);
  const files = fs.readdirSync(path.join(dir, 'queue'));
  assert.strictEqual(files.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('empty stdin exits 0 (timeout guard)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-enq-'));
  const res = runEnqueue('', dir);
  assert.strictEqual(res.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('session ids are sanitized for the filesystem', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-enq-'));
  const res = runEnqueue(JSON.stringify({ session_id: '../evil/../../id' }), dir);
  assert.strictEqual(res.status, 0);
  const files = fs.readdirSync(path.join(dir, 'queue'));
  assert.strictEqual(files.length, 1);
  assert.ok(!files[0].includes('/'));
  assert.ok(!files[0].includes('..'), 'dots must be sanitized: ' + files[0]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enqueue is fast enough for a session-end hook', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-enq-'));
  const start = Date.now();
  const res = runEnqueue(JSON.stringify({ session_id: 'speed' }), dir);
  const elapsed = Date.now() - start;
  assert.strictEqual(res.status, 0);
  // Local target is ~100 ms; the CI bound is loose to absorb slow runners.
  assert.ok(elapsed < 3000, 'enqueue took ' + elapsed + ' ms');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('last write wins when a session ends twice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-enq-'));
  runEnqueue(JSON.stringify({ session_id: 'twice', reason: 'clear' }), dir);
  runEnqueue(JSON.stringify({ session_id: 'twice', reason: 'other' }), dir);
  const entry = JSON.parse(fs.readFileSync(path.join(dir, 'queue', 'twice.json'), 'utf8'));
  assert.strictEqual(entry.reason, 'other');
  fs.rmSync(dir, { recursive: true, force: true });
});
