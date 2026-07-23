#!/usr/bin/env node
'use strict';

// The detached worker. Spawned by scripts/enqueue.js after every session
// end (and runnable by hand, or with --deep for a full history sweep).
//
//   worker.js          drain the queue, index, re-cluster, exit
//   worker.js --deep   also sweep ~/.claude/projects for unindexed or
//                      grown transcripts (bounded per run), then cluster
//
// Guarantees: singleton via an atomic mkdir lock (stale-stolen after 15
// minutes), low priority, never touches the network, always exits 0.

const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('./paths');
const configMod = require('./config');
const db = require('./db');
const indexer = require('./indexer');
const cluster = require('./cluster');

const LOCK_STALE_MS = 15 * 60 * 1000;
const DEEP_BATCH = 500;
const LOG_MAX_BYTES = 512 * 1024;

function log(msg) {
  try {
    const dir = paths.logsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'worker.log');
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) {
        fs.renameSync(file, file + '.1');
      }
    } catch (_) { /* first write */ }
    fs.appendFileSync(file, new Date().toISOString() + ' ' + msg + '\n');
  } catch (_) { /* logging never breaks the worker */ }
}

function acquireLock() {
  const lock = paths.lockDir();
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  try {
    fs.mkdirSync(lock);
  } catch (_) {
    // Held. Steal only if stale.
    try {
      const st = fs.statSync(lock);
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(lock, { recursive: true, force: true });
        fs.mkdirSync(lock);
      } else {
        return false;
      }
    } catch (_) {
      return false;
    }
  }
  try {
    fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
  } catch (_) { /* best effort */ }
  return true;
}

function releaseLock() {
  try {
    fs.rmSync(paths.lockDir(), { recursive: true, force: true });
  } catch (_) { /* best effort */ }
}

function drainQueue(database, config) {
  const dir = paths.queueDir();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (_) {
    return 0;
  }
  let processed = 0;
  for (const f of files) {
    const full = path.join(dir, f);
    let entry = null;
    try {
      entry = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (_) {
      entry = null;
    }
    if (entry && entry.session_id) {
      try {
        const status = indexer.indexSession(database, entry, config);
        log('indexed ' + entry.session_id + ' -> ' + status);
        processed++;
      } catch (err) {
        log('index error ' + entry.session_id + ': ' + (err && err.message));
      }
    }
    // One attempt per enqueue: remove the queue file regardless, so a
    // poison entry can never loop forever. Failures live on as session
    // status in the DB.
    try { fs.unlinkSync(full); } catch (_) { /* already gone */ }
  }
  return processed;
}

function deepSweep(database, config) {
  const root = paths.projectsRoot();
  const found = indexer.discoverTranscripts(root);
  let processed = 0;
  for (const t of found) {
    if (processed >= DEEP_BATCH) break;
    if (!indexer.needsIndexing(database, t.session_id, t.transcript_path)) continue;
    try {
      const status = indexer.indexSession(database, {
        session_id: t.session_id,
        transcript_path: t.transcript_path,
        cwd: null
      }, config);
      log('deep indexed ' + t.session_id + ' -> ' + status);
      processed++;
    } catch (err) {
      log('deep index error ' + t.session_id + ': ' + (err && err.message));
    }
  }
  const remaining = found.filter((t) => indexer.needsIndexing(database, t.session_id, t.transcript_path)).length;
  db.setMeta(database, 'deep_last_run', new Date().toISOString());
  db.setMeta(database, 'deep_remaining', String(remaining));
  return { processed, remaining };
}

function main() {
  const deep = process.argv.includes('--deep');

  try {
    os.setPriority(10);
  } catch (_) { /* best effort */ }

  if (!acquireLock()) {
    // Another worker is live; it will drain what we enqueued.
    process.exit(0);
  }

  let database = null;
  try {
    if (!db.available()) {
      // Node too old for node:sqlite. Leave a breadcrumb the status skill
      // can read without a database.
      try {
        fs.mkdirSync(paths.dataDir(), { recursive: true });
        fs.writeFileSync(path.join(paths.dataDir(), 'runtime-warning.txt'), db.unavailableReason() + '\n');
      } catch (_) { /* best effort */ }
      log('abort: ' + db.unavailableReason());
      process.exit(0);
    }
    try { fs.rmSync(path.join(paths.dataDir(), 'runtime-warning.txt'), { force: true }); } catch (_) { /* ok */ }

    const config = configMod.load();
    database = db.open(paths.dbPath());

    const drained = drainQueue(database, config);
    let deepStats = null;
    if (deep) deepStats = deepSweep(database, config);

    cluster.recluster(database, config);

    db.setMeta(database, 'last_run_at', new Date().toISOString());
    db.setMeta(database, 'last_run_kind', deep ? 'deep' : 'queue');
    log('run complete: drained=' + drained + (deepStats ? ' deep=' + deepStats.processed + ' remaining=' + deepStats.remaining : ''));
  } catch (err) {
    log('worker error: ' + (err && err.stack ? err.stack : String(err)));
  } finally {
    try { if (database) database.close(); } catch (_) { /* ok */ }
    releaseLock();
  }
  process.exit(0);
}

main();
