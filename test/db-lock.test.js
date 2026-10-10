'use strict';

// Two connections to one database file at the same moment. The worker,
// cli.js and the detach test in worker.test.js can all open repeatable.db
// together. Before db.js waited on locks, the detach test failed now and
// then in CI with "worker error: Error: database is locked" from open().

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dbMod = require('../worker/db');

// How long the holder keeps its write transaction open after it sees the
// test is about to run its own statement. Well under BUSY_TIMEOUT_MS, so a
// statement that waits succeeds.
const HOLD_MS = 1500;

// Runs in a child process, because node:sqlite is synchronous: a holder in
// this process could never commit while our statement waits. It opens the
// file directly (not through db.open), starts a write transaction, waits
// for the test's marker file, keeps the transaction open for HOLD_MS more,
// then commits. Its own busy timeout lets its COMMIT wait out the brief
// read locks the waiting side takes while it retries. The script is written
// to a file with its inputs inlined as JSON, so no platform's argument
// quoting is involved.
function holderScript(dbPath, marker, sql) {
  return [
    "'use strict';",
    "const fs = require('fs');",
    "const { DatabaseSync } = require('node:sqlite');",
    'const dbPath = ' + JSON.stringify(dbPath) + ';',
    'const marker = ' + JSON.stringify(marker) + ';',
    'const sql = ' + JSON.stringify(sql) + ';',
    'const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);',
    'const db = new DatabaseSync(dbPath);',
    "db.exec('PRAGMA busy_timeout = 20000;');",
    "db.exec('BEGIN IMMEDIATE; ' + sql);",
    "console.log('locked');",
    'const giveUp = Date.now() + 20000;',
    'while (!fs.existsSync(marker)) {',
    "  if (Date.now() > giveUp) { console.log('no marker'); process.exit(3); }",
    '  sleep(20);',
    '}',
    'sleep(' + HOLD_MS + ');',
    "console.log('releasing ' + Date.now());",
    "db.exec('COMMIT;');",
    'db.close();',
    ''
  ].join('\n');
}

// Start a holder running `sql` inside a write transaction, wait until it
// holds the lock, then run `action` while it still does. Asserts from the
// timings that `action` really waited, and returns what it returned.
async function whileAnotherConnectionWrites(dbPath, sql, action) {
  const marker = dbPath + '.opening';
  const script = path.join(path.dirname(dbPath), 'holder.js');
  fs.writeFileSync(script, holderScript(dbPath, marker, sql));
  const holder = spawn(process.execPath, ['--no-warnings', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  holder.stdout.on('data', (d) => { out += d; });
  holder.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((resolve) => holder.on('exit', (code) => resolve(code)));
  try {
    await new Promise((resolve, reject) => {
      const check = () => { if (out.includes('locked')) resolve(); };
      holder.stdout.on('data', check);
      exited.then((code) => reject(new Error('holder exited before locking, rc=' + code + ': ' + out + err)));
      check();
    });

    // Tell the holder we are starting, then run while it still holds the
    // write lock. Without the waiting in db.js this throws "database is
    // locked" at once.
    fs.writeFileSync(marker, '');
    const startedAt = Date.now();
    const result = action();
    const finishedAt = Date.now();

    const code = await exited;
    assert.strictEqual(code, 0, 'holder failed: ' + out + err);
    const m = out.match(/releasing (\d+)/);
    assert.ok(m, 'holder never released: ' + out + err);
    const releasedAt = Number(m[1]);

    // Control: the action started while the lock was held and finished
    // only after the holder let go, so it really waited on the lock.
    assert.ok(startedAt < releasedAt, 'action started after the holder let go; the lock was never exercised');
    assert.ok(finishedAt >= releasedAt, 'action finished before the holder let go');
    return result;
  } finally {
    holder.kill();
    await exited;
  }
}

test('open() on a fresh file waits for another connection\'s write transaction', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-dblock-'));
  const dbPath = path.join(dir, 'repeatable.db');
  let database = null;
  try {
    // The holder writes to the brand-new file before anything has switched
    // it to WAL, as the first of two racing openers does.
    database = await whileAnotherConnectionWrites(dbPath,
      'CREATE TABLE holder (x INTEGER); INSERT INTO holder (x) VALUES (1);',
      () => dbMod.open(dbPath));

    assert.strictEqual(database.prepare('PRAGMA busy_timeout').get().timeout, dbMod.BUSY_TIMEOUT_MS);
    assert.ok(dbMod.BUSY_TIMEOUT_MS > HOLD_MS, 'the hold must fit inside the busy timeout');
    assert.strictEqual(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.strictEqual(dbMod.getMeta(database, 'schema_version'), String(dbMod.SCHEMA_VERSION));
    assert.strictEqual(database.prepare('SELECT x FROM holder').get().x, 1, 'the holder\'s committed row is visible');
  } finally {
    if (database) database.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a write on an open handle waits for another connection\'s write transaction', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-dblock-'));
  const dbPath = path.join(dir, 'repeatable.db');
  const database = dbMod.open(dbPath);
  try {
    // The file is WAL now, so this is the worker and cli.js both writing.
    await whileAnotherConnectionWrites(dbPath,
      "INSERT INTO meta (key, value) VALUES ('holder', '1');",
      () => dbMod.setMeta(database, 'waiter', '2'));

    assert.strictEqual(dbMod.getMeta(database, 'holder'), '1');
    assert.strictEqual(dbMod.getMeta(database, 'waiter'), '2');
  } finally {
    database.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
