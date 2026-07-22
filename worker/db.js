'use strict';

// Local index on Node's built-in node:sqlite (DatabaseSync).
//
// Why not better-sqlite3: zero npm dependencies means no install step, no
// native builds, and a minimal supply-chain surface (see CLAUDE.md). This
// module is the ONLY code that touches node:sqlite, so if its API ever
// breaks we swap this file for a better-sqlite3 implementation behind the
// same exported interface.
//
// node:sqlite still prints an ExperimentalWarning; suppress just that one
// before loading so worker/cli output stays clean.

const fs = require('fs');
const path = require('path');

const origEmitWarning = process.emitWarning.bind(process);
process.emitWarning = function (warning, ...args) {
  const msg = String((warning && warning.message) || warning || '');
  if (msg.includes('SQLite is an experimental feature')) return;
  return origEmitWarning(warning, ...args);
};

let DatabaseSync = null;
let loadError = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  loadError = err;
}

const SCHEMA_VERSION = 1;

function available() {
  return !!DatabaseSync;
}

function unavailableReason() {
  if (DatabaseSync) return null;
  return 'node:sqlite is unavailable on this Node runtime (' + process.version +
    '). Repeatable needs Node 22.13 or newer. ' +
    (loadError && loadError.message ? loadError.message : '');
}

function open(dbPath) {
  if (!DatabaseSync) {
    const err = new Error(unavailableReason());
    err.code = 'REPEATABLE_NO_SQLITE';
    throw err;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project TEXT,
      cwd TEXT,
      transcript_path TEXT,
      started_at TEXT,
      ended_at TEXT,
      prompt_count INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      status TEXT,
      content_bytes INTEGER DEFAULT 0,
      prompts_json TEXT,
      toolseq_json TEXT,
      minhash_json TEXT,
      indexed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS clusters (
      cluster_id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT UNIQUE,
      status TEXT,
      first_day TEXT,
      last_day TEXT,
      session_count INTEGER DEFAULT 0,
      project TEXT,
      title_hint TEXT,
      blueprint_id TEXT,
      last_pushed_at TEXT,
      last_pushed_checksum TEXT,
      dismissed_count INTEGER DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS cluster_members (
      cluster_id INTEGER,
      session_id TEXT,
      PRIMARY KEY (cluster_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS proposals (
      proposal_id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT,
      source TEXT,
      draft_json TEXT,
      status TEXT,
      created_at TEXT
    );
  `);
  const row = getMeta(db, 'schema_version');
  if (!row) setMeta(db, 'schema_version', String(SCHEMA_VERSION));
}

function getMeta(db, key) {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return r ? r.value : null;
}

function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

function upsertSession(db, s) {
  db.prepare(`
    INSERT INTO sessions (session_id, project, cwd, transcript_path, started_at, ended_at,
      prompt_count, tool_call_count, status, content_bytes, prompts_json, toolseq_json,
      minhash_json, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      project = excluded.project,
      cwd = excluded.cwd,
      transcript_path = excluded.transcript_path,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      prompt_count = excluded.prompt_count,
      tool_call_count = excluded.tool_call_count,
      status = excluded.status,
      content_bytes = excluded.content_bytes,
      prompts_json = excluded.prompts_json,
      toolseq_json = excluded.toolseq_json,
      minhash_json = excluded.minhash_json,
      indexed_at = excluded.indexed_at
  `).run(
    s.session_id, s.project || null, s.cwd || null, s.transcript_path || null,
    s.started_at || null, s.ended_at || null,
    s.prompt_count | 0, s.tool_call_count | 0, s.status || 'indexed',
    s.content_bytes | 0, s.prompts_json || null, s.toolseq_json || null,
    s.minhash_json || null, new Date().toISOString()
  );
}

function getSession(db, sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) || null;
}

function clusterableSessions(db) {
  return db.prepare("SELECT * FROM sessions WHERE status = 'indexed'").all();
}

function allClusters(db) {
  return db.prepare('SELECT * FROM clusters ORDER BY cluster_id').all();
}

function getClusterByFingerprint(db, fingerprint) {
  return db.prepare('SELECT * FROM clusters WHERE fingerprint = ?').get(fingerprint) || null;
}

function memberSessionIds(db, clusterId) {
  return db.prepare('SELECT session_id FROM cluster_members WHERE cluster_id = ? ORDER BY session_id')
    .all(clusterId).map((r) => r.session_id);
}

module.exports = {
  available,
  unavailableReason,
  open,
  SCHEMA_VERSION,
  getMeta,
  setMeta,
  upsertSession,
  getSession,
  clusterableSessions,
  allClusters,
  getClusterByFingerprint,
  memberSessionIds
};
