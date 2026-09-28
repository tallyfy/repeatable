'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dbMod = require('../worker/db');
const indexer = require('../worker/indexer');
const cluster = require('../worker/cluster');
const configMod = require('../worker/config');
const synth = require('./helpers/synth');
const { workerEnv } = require('../worker/env');

const CONFIG = configMod.DEFAULTS;
const CLI = path.join(__dirname, '..', 'worker', 'cli.js');

function freshEnv() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-cluster-'));
  const database = dbMod.open(path.join(dataDir, 'repeatable.db'));
  return { dataDir, database };
}

function indexFamily(database, dir, prefix, days, mk) {
  for (let i = 0; i < days.length; i++) {
    const id = prefix + '-' + i;
    const p = synth.writeTranscript(dir, id, mk(i, days[i]));
    indexer.indexSession(database, { session_id: id, transcript_path: p, cwd: synth.FAKE_CWD }, CONFIG);
  }
}

// Three process families plus unrelated noise: family members must
// cluster together, families must never merge, noise must stay out.
test('families cluster; no cross-family merges; noise stays out', () => {
  const { dataDir, database } = freshEnv();

  indexFamily(database, dataDir, 'rel', ['2026-07-01', '2026-07-08', '2026-07-15'], (i, day) =>
    synth.releaseNotesSession(i, day, '2.' + (14 + i) + '.0', '/home/tester/fakerepo/CHANGELOG.md', i === 0 ? 'stable' : 'beta'));

  indexFamily(database, dataDir, 'onb', ['2026-07-02', '2026-07-09', '2026-07-16'], (i, day) =>
    synth.processSession({
      day,
      prompts: [
        'Onboard the new customer FakeCo ' + i + ' by creating their workspace and inviting the team',
        'Send the onboarding welcome email to FakeCo ' + i + ' with the getting started guide attached'
      ],
      toolsPerPrompt: [['Task', 'Bash'], ['Write', 'Bash']]
    }));

  indexFamily(database, dataDir, 'inv', ['2026-07-03', '2026-07-10', '2026-07-17'], (i, day) =>
    synth.processSession({
      day,
      prompts: [
        'Prepare the monthly invoice rollup for client number ' + (100 + i) + ' from the billing export',
        'Reconcile the totals against the ledger and flag any mismatch above 100 dollars'
      ],
      toolsPerPrompt: [['Read', 'Bash'], ['Read', 'Edit']]
    }));

  // Noise: three unrelated one-off sessions
  indexFamily(database, dataDir, 'noise', ['2026-07-04', '2026-07-11', '2026-07-18'], (i, day) =>
    synth.unrelatedSession(day, ['flaky login test', 'slow dashboard query', 'broken webpack build'][i]));

  const groups = cluster.recluster(database, CONFIG);
  const qualified = groups.filter((g) => g.qualified);
  assert.strictEqual(qualified.length, 3, 'exactly the three families qualify, got ' + JSON.stringify(groups));

  for (const g of qualified) {
    const prefixes = new Set(g.members.map((m) => m.split('-')[0]));
    assert.strictEqual(prefixes.size, 1, 'cross-family merge detected: ' + g.members.join(','));
    assert.strictEqual(g.members.length, 3);
  }

  const clustered = new Set(qualified.flatMap((g) => g.members));
  for (let i = 0; i < 3; i++) assert.ok(!clustered.has('noise-' + i), 'noise session clustered');

  database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('min_days boundary: 3 sessions on one day form but do not qualify', () => {
  const { dataDir, database } = freshEnv();
  indexFamily(database, dataDir, 'same', ['2026-07-01', '2026-07-01', '2026-07-01'], (i, day) =>
    synth.releaseNotesSession(i, day, '3.' + i + '.0', 'CHANGELOG.md', 'stable'));
  cluster.recluster(database, CONFIG);
  const rows = dbMod.allClusters(database);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'forming', 'one-day repetition must not qualify');

  // A fourth run on a second day crosses min_days
  const p = synth.writeTranscript(dataDir, 'same-3', synth.releaseNotesSession(3, '2026-07-02', '3.3.0', 'CHANGELOG.md', 'beta'));
  indexer.indexSession(database, { session_id: 'same-3', transcript_path: p, cwd: synth.FAKE_CWD }, CONFIG);
  cluster.recluster(database, CONFIG);
  assert.strictEqual(dbMod.allClusters(database)[0].status, 'candidate');
  database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('min_sessions boundary: 2 similar sessions never qualify at default 3', () => {
  const { dataDir, database } = freshEnv();
  indexFamily(database, dataDir, 'two', ['2026-07-01', '2026-07-02'], (i, day) =>
    synth.releaseNotesSession(i, day, '4.' + i + '.0', 'CHANGELOG.md', 'stable'));
  cluster.recluster(database, CONFIG);
  const rows = dbMod.allClusters(database);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'forming');
  database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('determinism: identical corpus produces identical clusters and fingerprints', () => {
  const run = () => {
    const { dataDir, database } = freshEnv();
    indexFamily(database, dataDir, 'det', ['2026-07-01', '2026-07-08', '2026-07-15'], (i, day) =>
      synth.releaseNotesSession(i, day, '5.' + i + '.0', 'CHANGELOG.md', 'stable'));
    cluster.recluster(database, CONFIG);
    const rows = dbMod.allClusters(database).map((c) => ({ fp: c.fingerprint, n: c.session_count, s: c.status }));
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    return rows;
  };
  assert.deepStrictEqual(run(), run());
});

test('fingerprint freezes at qualification and survives growth', () => {
  const { dataDir, database } = freshEnv();
  indexFamily(database, dataDir, 'grow', ['2026-07-01', '2026-07-08', '2026-07-15'], (i, day) =>
    synth.releaseNotesSession(i, day, '6.' + i + '.0', 'CHANGELOG.md', 'stable'));
  cluster.recluster(database, CONFIG);
  const before = dbMod.allClusters(database)[0];
  assert.strictEqual(before.status, 'candidate');

  const p = synth.writeTranscript(dataDir, 'grow-3', synth.releaseNotesSession(3, '2026-07-20', '6.9.0', 'OTHER.md', 'beta'));
  indexer.indexSession(database, { session_id: 'grow-3', transcript_path: p, cwd: synth.FAKE_CWD }, CONFIG);
  cluster.recluster(database, CONFIG);
  const after = dbMod.allClusters(database)[0];
  assert.strictEqual(after.fingerprint, before.fingerprint, 'fingerprint must not change as the cluster grows');
  assert.strictEqual(after.session_count, 4);
  database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('dismissed clusters stay tombstoned until membership doubles', () => {
  const { dataDir, database } = freshEnv();
  indexFamily(database, dataDir, 'dis', ['2026-07-01', '2026-07-08', '2026-07-15'], (i, day) =>
    synth.releaseNotesSession(i, day, '7.' + i + '.0', 'CHANGELOG.md', 'stable'));
  cluster.recluster(database, CONFIG);
  const fp = dbMod.allClusters(database)[0].fingerprint;
  database.close();

  // Dismiss through the real CLI
  const res = spawnSync(process.execPath, [CLI, 'mark', '--fingerprint', fp, '--status', 'dismissed'],
    { env: workerEnv({ REPEATABLE_DATA_DIR: dataDir }), encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);

  // One more occurrence: 4 < 3*2, stays dismissed
  const db2 = dbMod.open(path.join(dataDir, 'repeatable.db'));
  const p = synth.writeTranscript(dataDir, 'dis-3', synth.releaseNotesSession(3, '2026-07-20', '7.9.0', 'CHANGELOG.md', 'stable'));
  indexer.indexSession(db2, { session_id: 'dis-3', transcript_path: p, cwd: synth.FAKE_CWD }, CONFIG);
  cluster.recluster(db2, CONFIG);
  assert.strictEqual(dbMod.allClusters(db2)[0].status, 'dismissed');

  // Two more: 6 >= 3*2, revives as candidate
  for (let i = 4; i <= 5; i++) {
    const pp = synth.writeTranscript(dataDir, 'dis-' + i, synth.releaseNotesSession(i, '2026-07-2' + i, '7.' + i + '.0', 'CHANGELOG.md', 'stable'));
    indexer.indexSession(db2, { session_id: 'dis-' + i, transcript_path: pp, cwd: synth.FAKE_CWD }, CONFIG);
  }
  cluster.recluster(db2, CONFIG);
  assert.strictEqual(dbMod.allClusters(db2)[0].status, 'candidate');
  db2.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('same prompts in different projects do not cluster by default', () => {
  const { dataDir, database } = freshEnv();
  const mk = (i, day, cwd) => {
    const lines = synth.releaseNotesSession(i, day, '8.' + i + '.0', 'CHANGELOG.md', 'stable')
      .map((l) => Object.assign({}, l, l.cwd ? { cwd } : {}));
    return lines;
  };
  for (let i = 0; i < 3; i++) {
    const cwd = i === 0 ? '/home/tester/repo-a' : '/home/tester/repo-b';
    const p = synth.writeTranscript(dataDir, 'xp-' + i, mk(i, '2026-07-0' + (i + 1), cwd));
    indexer.indexSession(database, { session_id: 'xp-' + i, transcript_path: p, cwd }, CONFIG);
  }
  const groups = cluster.recluster(database, CONFIG);
  assert.strictEqual(groups.filter((g) => g.qualified).length, 0, 'cross-project sessions must not qualify together by default');
  database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
