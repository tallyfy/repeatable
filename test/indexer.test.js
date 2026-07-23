'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbMod = require('../worker/db');
const indexer = require('../worker/indexer');
const configMod = require('../worker/config');
const synth = require('./helpers/synth');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-idx-'));
}

const CONFIG = configMod.DEFAULTS;

test('indexing enforces the storage allowlist at the database level', () => {
  const dir = tmp();
  const dbPath = path.join(dir, 'repeatable.db');
  const database = dbMod.open(dbPath);

  const lines = synth.releaseNotesSession(1, '2026-07-01', '2.14.1', '/home/tester/fakerepo/CHANGELOG.md', 'stable');
  const tPath = synth.writeTranscript(dir, 's-allow', lines);
  const status = indexer.indexSession(database, { session_id: 's-allow', transcript_path: tPath, cwd: synth.FAKE_CWD }, CONFIG);
  assert.strictEqual(status, 'indexed');
  database.close();

  // The strongest possible check: the planted markers must not appear
  // anywhere in the raw database bytes (including WAL).
  let raw = fs.readFileSync(dbPath, 'latin1');
  try { raw += fs.readFileSync(dbPath + '-wal', 'latin1'); } catch (_) { /* no wal */ }
  assert.ok(!raw.includes('TOOL-RESULT-NEVER-STORED'), 'tool results leaked into the DB');
  assert.ok(!raw.includes('ASSISTANT-TEXT-NEVER-STORED'), 'assistant text leaked into the DB');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('planted secrets in prompts are stored as REDACTED', () => {
  const dir = tmp();
  const database = dbMod.open(path.join(dir, 'repeatable.db'));
  const lines = [
    synth.userLine('Deploy using token ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234 to production', '2026-07-01', 9, 0),
    synth.assistantLine('Bash', { command: 'true' }, '2026-07-01', 9, 1)
  ];
  const tPath = synth.writeTranscript(dir, 's-secret', lines);
  indexer.indexSession(database, { session_id: 's-secret', transcript_path: tPath, cwd: synth.FAKE_CWD }, CONFIG);
  const row = dbMod.getSession(database, 's-secret');
  const prompts = JSON.parse(row.prompts_json);
  assert.ok(prompts[0].includes('[REDACTED]'));
  assert.ok(!prompts[0].includes('ghp_FAKE'));
  database.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('trivial sessions are filtered from clustering', () => {
  const dir = tmp();
  const database = dbMod.open(path.join(dir, 'repeatable.db'));
  // No prompts at all -> trivial
  const lines = [synth.assistantLine('Read', {}, '2026-07-01', 9, 0)];
  const tPath = synth.writeTranscript(dir, 's-trivial', lines);
  const status = indexer.indexSession(database, { session_id: 's-trivial', transcript_path: tPath, cwd: synth.FAKE_CWD }, CONFIG);
  assert.strictEqual(status, 'trivial');
  assert.strictEqual(dbMod.clusterableSessions(database).length, 0);
  database.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ignored projects are never indexed for clustering', () => {
  const dir = tmp();
  const database = dbMod.open(path.join(dir, 'repeatable.db'));
  const lines = synth.releaseNotesSession(1, '2026-07-01', '2.14.1', 'CHANGELOG.md', 'stable');
  const tPath = synth.writeTranscript(dir, 's-ignored', lines);
  const config = Object.assign({}, CONFIG, { ignore_projects: ['/home/tester/fakerepo'] });
  const status = indexer.indexSession(database, { session_id: 's-ignored', transcript_path: tPath, cwd: synth.FAKE_CWD }, config);
  assert.strictEqual(status, 'ignored');
  const row = dbMod.getSession(database, 's-ignored');
  assert.strictEqual(row.prompts_json, null, 'ignored sessions must store no prompt content');
  database.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('grown transcripts are re-indexed; unchanged ones are not', () => {
  const dir = tmp();
  const database = dbMod.open(path.join(dir, 'repeatable.db'));
  const lines = synth.releaseNotesSession(1, '2026-07-01', '2.14.1', 'CHANGELOG.md', 'stable');
  const tPath = synth.writeTranscript(dir, 's-grow', lines);
  indexer.indexSession(database, { session_id: 's-grow', transcript_path: tPath, cwd: synth.FAKE_CWD }, CONFIG);
  assert.strictEqual(indexer.needsIndexing(database, 's-grow', tPath), false);
  // Session resumes: transcript grows
  fs.appendFileSync(tPath, JSON.stringify(synth.userLine('One more follow-up request please', '2026-07-01', 10, 0)) + '\n');
  assert.strictEqual(indexer.needsIndexing(database, 's-grow', tPath), true);
  indexer.indexSession(database, { session_id: 's-grow', transcript_path: tPath, cwd: synth.FAKE_CWD }, CONFIG);
  const row = dbMod.getSession(database, 's-grow');
  assert.strictEqual(JSON.parse(row.prompts_json).length, 3);
  database.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deep-scan entries pick up cwd from the transcript itself', () => {
  const dir = tmp();
  const database = dbMod.open(path.join(dir, 'repeatable.db'));
  const lines = synth.releaseNotesSession(1, '2026-07-01', '2.14.1', 'CHANGELOG.md', 'stable');
  const tPath = synth.writeTranscript(dir, 's-deep', lines);
  indexer.indexSession(database, { session_id: 's-deep', transcript_path: tPath, cwd: null }, CONFIG);
  const row = dbMod.getSession(database, 's-deep');
  assert.strictEqual(row.project, synth.FAKE_CWD);
  database.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('discoverTranscripts finds jsonl files sorted by mtime', () => {
  const dir = tmp();
  const proj = path.join(dir, 'projects', '-home-tester-fakerepo');
  synth.writeTranscript(proj, 'newer', synth.unrelatedSession('2026-07-02', 'cache bug'));
  synth.writeTranscript(proj, 'older', synth.unrelatedSession('2026-07-01', 'login bug'));
  const older = path.join(proj, 'older.jsonl');
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(older, past, past);
  const found = indexer.discoverTranscripts(path.join(dir, 'projects'));
  assert.deepStrictEqual(found.map((f) => f.session_id), ['older', 'newer']);
  fs.rmSync(dir, { recursive: true, force: true });
});
