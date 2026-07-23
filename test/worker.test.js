'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const dbMod = require('../worker/db');
const synth = require('./helpers/synth');

const WORKER = path.join(__dirname, '..', 'worker', 'worker.js');
const ENQUEUE = path.join(__dirname, '..', 'scripts', 'enqueue.js');
const CLI = path.join(__dirname, '..', 'worker', 'cli.js');

function env(dataDir, projectsRoot) {
  return Object.assign({}, process.env, {
    REPEATABLE_DATA_DIR: dataDir,
    REPEATABLE_PROJECTS_ROOT: projectsRoot || path.join(dataDir, 'no-projects')
  });
}

function enqueueSession(dataDir, sessionId, transcriptPath) {
  fs.mkdirSync(path.join(dataDir, 'queue'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'queue', sessionId + '.json'), JSON.stringify({
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd: synth.FAKE_CWD,
    reason: 'other'
  }));
}

test('worker drains the queue, indexes, clusters, and empties the queue', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-worker-'));
  const days = ['2026-07-01', '2026-07-08', '2026-07-15'];
  for (let i = 0; i < 3; i++) {
    const p = synth.writeTranscript(dir, 'w-' + i,
      synth.releaseNotesSession(i, days[i], '9.' + i + '.0', 'CHANGELOG.md', 'stable'));
    enqueueSession(dir, 'w-' + i, p);
  }
  const res = spawnSync(process.execPath, [WORKER], { env: env(dir), encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(res.status, 0);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'queue')), [], 'queue must be empty after a run');

  const database = dbMod.open(path.join(dir, 'repeatable.db'));
  assert.strictEqual(dbMod.clusterableSessions(database).length, 3);
  const clusters = dbMod.allClusters(database);
  assert.strictEqual(clusters.length, 1);
  assert.strictEqual(clusters[0].status, 'candidate');
  database.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a poison queue entry is consumed without looping and without crashing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-worker-'));
  fs.mkdirSync(path.join(dir, 'queue'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'queue', 'poison.json'), 'not json at all');
  const res = spawnSync(process.execPath, [WORKER], { env: env(dir), encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(res.status, 0);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'queue')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the lock keeps a second worker out; removal lets it in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-worker-'));
  const p = synth.writeTranscript(dir, 'lk-0', synth.unrelatedSession('2026-07-01', 'lock check'));
  enqueueSession(dir, 'lk-0', p);

  // Hold the lock (fresh mtime): the worker must exit WITHOUT draining.
  fs.mkdirSync(path.join(dir, 'worker.lock.d'), { recursive: true });
  let res = spawnSync(process.execPath, [WORKER], { env: env(dir), encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(fs.readdirSync(path.join(dir, 'queue')).length, 1, 'locked worker must not drain');

  // Release the lock: now it drains.
  fs.rmdirSync(path.join(dir, 'worker.lock.d'));
  res = spawnSync(process.execPath, [WORKER], { env: env(dir), encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(fs.readdirSync(path.join(dir, 'queue')).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deep sweep indexes discovered transcripts and reports remaining', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-worker-'));
  const projects = path.join(dir, 'projects');
  const projDir = path.join(projects, '-home-tester-fakerepo');
  const days = ['2026-07-01', '2026-07-08'];
  for (let i = 0; i < 2; i++) {
    synth.writeTranscript(projDir, 'deep-' + i,
      synth.releaseNotesSession(i, days[i], '10.' + i + '.0', 'CHANGELOG.md', 'stable'));
  }
  const res = spawnSync(process.execPath, [WORKER, '--deep'], { env: env(dir, projects), encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(res.status, 0);
  const database = dbMod.open(path.join(dir, 'repeatable.db'));
  assert.strictEqual(dbMod.clusterableSessions(database).length, 2);
  assert.strictEqual(dbMod.getMeta(database, 'deep_remaining'), '0');
  database.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// Windows: detached-process behavior is the one thing we refuse to claim
// until validated on real machines (README "Platform support", issue #8
// help wanted). CI observation backs the caution: this test passed on
// windows-latest Node 24 but failed on Node 22 in the same run. The
// other tests all run (and pass) on Windows.
test('enqueue-spawned worker survives its parent exiting (the #41577 answer)',
  { skip: process.platform === 'win32' ? 'Windows detach behavior not yet validated (issue #8)' : false },
  async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-worker-'));
  const p = synth.writeTranscript(dir, 'detach-0', synth.unrelatedSession('2026-07-01', 'detach check'));

  // A short-lived parent runs enqueue (real spawn enabled) and dies
  // immediately. The detached worker must finish indexing anyway.
  const parent = spawn(process.execPath, [ENQUEUE], {
    env: Object.assign({}, process.env, {
      REPEATABLE_DATA_DIR: dir,
      REPEATABLE_PROJECTS_ROOT: path.join(dir, 'no-projects')
    }),
    stdio: ['pipe', 'ignore', 'ignore']
  });
  parent.stdin.write(JSON.stringify({
    session_id: 'detach-0',
    transcript_path: p,
    cwd: synth.FAKE_CWD,
    reason: 'other'
  }));
  parent.stdin.end();
  await new Promise((resolve) => parent.on('exit', resolve));

  // Parent is dead. Poll for the detached worker's output. The deadline
  // is generous because shared CI runners boot two cold node processes
  // (enqueue, then the nice-10 worker) under noisy-neighbor load.
  const deadline = Date.now() + 60000;
  let row = null;
  while (Date.now() < deadline) {
    try {
      const database = dbMod.open(path.join(dir, 'repeatable.db'));
      row = dbMod.getSession(database, 'detach-0');
      database.close();
      if (row) break;
    } catch (_) { /* db not created yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!row) {
    // Make a rare failure diagnosable: what did the detached pieces log?
    let diag = '';
    for (const f of ['logs/enqueue.log', 'logs/worker.log']) {
      try { diag += '\n--- ' + f + ' ---\n' + fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { diag += '\n--- ' + f + ': absent ---'; }
    }
    try { diag += '\n--- queue ---\n' + fs.readdirSync(path.join(dir, 'queue')).join(','); } catch (_) { diag += '\n--- queue: absent ---'; }
    assert.fail('detached worker did not index after parent exit' + diag);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli status and pending read what the worker wrote', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-worker-'));
  const days = ['2026-07-01', '2026-07-08', '2026-07-15'];
  for (let i = 0; i < 3; i++) {
    const p = synth.writeTranscript(dir, 'cli-' + i,
      synth.releaseNotesSession(i, days[i], '11.' + i + '.0', 'CHANGELOG.md', 'stable'));
    enqueueSession(dir, 'cli-' + i, p);
  }
  spawnSync(process.execPath, [WORKER], { env: env(dir), encoding: 'utf8', timeout: 60000 });

  const status = JSON.parse(spawnSync(process.execPath, [CLI, 'status'],
    { env: env(dir), encoding: 'utf8', timeout: 30000 }).stdout);
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.sessions.indexed, 3);
  assert.strictEqual(status.candidates.length, 1);

  const pending = JSON.parse(spawnSync(process.execPath, [CLI, 'pending'],
    { env: env(dir), encoding: 'utf8', timeout: 30000 }).stdout);
  assert.strictEqual(pending.length, 1);
  assert.match(pending[0].fingerprint, /^[0-9a-f]{10,12}$/);

  const detail = JSON.parse(spawnSync(process.execPath, [CLI, 'cluster', '--fingerprint', pending[0].fingerprint],
    { env: env(dir), encoding: 'utf8', timeout: 30000 }).stdout);
  assert.strictEqual(detail.members.length, 3);
  assert.ok(Array.isArray(detail.members[0].prompts));
  assert.ok(Array.isArray(detail.members[0].tool_sequence));
  fs.rmSync(dir, { recursive: true, force: true });
});
