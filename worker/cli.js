#!/usr/bin/env node
'use strict';

// CLI the skills call. Every command prints JSON to stdout so the skill
// can read it reliably. Exit codes: 0 ok, 2 usage/error, 3 secrets found
// (redact-check only).
//
//   node worker/cli.js doctor
//   node worker/cli.js status
//   node worker/cli.js pending
//   node worker/cli.js cluster --fingerprint <fp>
//   node worker/cli.js mark --fingerprint <fp> --status <s> [--blueprint-id <id>] [--checksum <c>]
//   node worker/cli.js save-proposal --fingerprint <fp> --file <path> [--source detected|import]
//   node worker/cli.js proposal --fingerprint <fp>
//   node worker/cli.js redact-check --file <path>
//   node worker/cli.js fingerprint-text --file <path>
//   node worker/cli.js config-get
//   node worker/cli.js config-set --key <dot.path> --value <json-or-string>
//   node worker/cli.js run [--deep]      (synchronous drain/sweep + cluster)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const paths = require('./paths');
const configMod = require('./config');
const dbMod = require('./db');
const redact = require('./redact');
const normalize = require('./normalize');

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function fail(msg, code) {
  out({ error: msg });
  process.exit(code === undefined ? 2 : code);
}

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function openDb() {
  if (!dbMod.available()) fail(dbMod.unavailableReason());
  return dbMod.open(paths.dbPath());
}

function runtimeWarning() {
  try {
    return fs.readFileSync(path.join(paths.dataDir(), 'runtime-warning.txt'), 'utf8').trim();
  } catch (_) {
    return null;
  }
}

function clusterSummary(db, c) {
  return {
    fingerprint: c.fingerprint,
    status: c.status,
    sessions: c.session_count,
    first_day: c.first_day,
    last_day: c.last_day,
    project: c.project,
    title_hint: c.title_hint,
    blueprint_id: c.blueprint_id || null
  };
}

const commands = {
  doctor() {
    const nodeOk = dbMod.available();
    const dataDir = paths.dataDir();
    let writable = false;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const probe = path.join(dataDir, '.probe');
      fs.writeFileSync(probe, 'ok');
      fs.rmSync(probe);
      writable = true;
    } catch (_) { writable = false; }
    out({
      node_version: process.version,
      node_sqlite_available: nodeOk,
      node_sqlite_note: nodeOk ? null : dbMod.unavailableReason(),
      data_dir: dataDir,
      data_dir_writable: writable,
      projects_root: paths.projectsRoot(),
      config: configMod.load()
    });
  },

  status() {
    const warning = runtimeWarning();
    if (!dbMod.available()) {
      out({ ok: false, runtime_warning: warning || dbMod.unavailableReason() });
      return;
    }
    const db = openDb();
    try {
      const counts = {};
      for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM sessions GROUP BY status').all()) {
        counts[row.status] = row.n;
      }
      const clusters = dbMod.allClusters(db);
      const parseFailed = counts.parse_failed || 0;
      out({
        ok: true,
        runtime_warning: warning,
        last_run_at: dbMod.getMeta(db, 'last_run_at'),
        last_run_kind: dbMod.getMeta(db, 'last_run_kind'),
        deep_remaining: dbMod.getMeta(db, 'deep_remaining'),
        sessions: counts,
        parse_warning: parseFailed > 0
          ? parseFailed + ' session(s) could not be parsed; the Claude Code log format may have changed. Update the plugin.'
          : null,
        candidates: clusters.filter((c) => c.status === 'candidate').map((c) => clusterSummary(db, c)),
        forming: clusters.filter((c) => c.status === 'forming').map((c) => clusterSummary(db, c)),
        proposed: clusters.filter((c) => c.status === 'proposed').map((c) => clusterSummary(db, c)),
        pushed: clusters.filter((c) => c.status === 'pushed').map((c) => clusterSummary(db, c)),
        dismissed: clusters.filter((c) => c.status === 'dismissed').length
      });
    } finally { db.close(); }
  },

  pending() {
    const db = openDb();
    try {
      const clusters = dbMod.allClusters(db)
        .filter((c) => c.status === 'candidate' || c.status === 'proposed');
      out(clusters.map((c) => clusterSummary(db, c)));
    } finally { db.close(); }
  },

  cluster() {
    const fp = arg('fingerprint');
    if (!fp) fail('missing --fingerprint');
    const db = openDb();
    try {
      const c = dbMod.getClusterByFingerprint(db, fp);
      if (!c) fail('no cluster with fingerprint ' + fp);
      const memberIds = dbMod.memberSessionIds(db, c.cluster_id);
      const members = memberIds.map((id) => {
        const s = dbMod.getSession(db, id);
        if (!s) return { session_id: id };
        let prompts = [];
        let seq = [];
        try { prompts = JSON.parse(s.prompts_json || '[]'); } catch (_) { prompts = []; }
        try { seq = (JSON.parse(s.toolseq_json || '{}').seq) || []; } catch (_) { seq = []; }
        return {
          session_id: id,
          project: s.project,
          started_at: s.started_at,
          ended_at: s.ended_at,
          transcript_path: s.transcript_path,
          transcript_still_on_disk: s.transcript_path ? fs.existsSync(s.transcript_path) : false,
          prompts,
          tool_sequence: seq
        };
      });
      out(Object.assign(clusterSummary(db, c), { members }));
    } finally { db.close(); }
  },

  mark() {
    const fp = arg('fingerprint');
    const status = arg('status');
    const allowed = ['candidate', 'proposed', 'pushed', 'dismissed'];
    if (!fp || !status) fail('need --fingerprint and --status');
    if (!allowed.includes(status)) fail('status must be one of ' + allowed.join(', '));
    const db = openDb();
    try {
      let c = dbMod.getClusterByFingerprint(db, fp);
      if (!c) {
        // Import fingerprints have no detected cluster; create a minimal
        // row so local dedupe works for them too.
        db.prepare('INSERT INTO clusters (fingerprint, status, session_count, updated_at) VALUES (?, ?, 0, ?)')
          .run(fp, 'proposed', new Date().toISOString());
        c = dbMod.getClusterByFingerprint(db, fp);
      }
      const blueprintId = arg('blueprint-id');
      const checksum = arg('checksum');
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE clusters SET status = ?,
          blueprint_id = COALESCE(?, blueprint_id),
          last_pushed_at = CASE WHEN ? = 'pushed' THEN ? ELSE last_pushed_at END,
          last_pushed_checksum = COALESCE(?, last_pushed_checksum),
          dismissed_count = CASE WHEN ? = 'dismissed' THEN session_count ELSE dismissed_count END,
          updated_at = ?
        WHERE cluster_id = ?
      `).run(status, blueprintId, status, now, checksum, status, now, c.cluster_id);
      out({ ok: true, fingerprint: fp, status });
    } finally { db.close(); }
  },

  'save-proposal'() {
    const fp = arg('fingerprint');
    const file = arg('file');
    if (!fp || !file) fail('need --fingerprint and --file');
    let draft;
    try {
      draft = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      fail('cannot read draft JSON: ' + err.message);
    }
    const findings = redact.findSecrets(JSON.stringify(draft));
    if (findings.length > 0) {
      out({ ok: false, blocked: 'secrets detected in draft', findings });
      process.exit(3);
    }
    const db = openDb();
    try {
      db.prepare('INSERT INTO proposals (fingerprint, source, draft_json, status, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(fp, arg('source') || 'detected', JSON.stringify(draft), 'draft', new Date().toISOString());
      fs.mkdirSync(paths.proposalsDir(), { recursive: true });
      fs.writeFileSync(path.join(paths.proposalsDir(), fp + '.json'), JSON.stringify(draft, null, 2));
      out({ ok: true, fingerprint: fp });
    } finally { db.close(); }
  },

  proposal() {
    const fp = arg('fingerprint');
    if (!fp) fail('missing --fingerprint');
    const db = openDb();
    try {
      const row = db.prepare('SELECT * FROM proposals WHERE fingerprint = ? ORDER BY proposal_id DESC LIMIT 1').get(fp);
      if (!row) fail('no proposal for fingerprint ' + fp);
      out({ fingerprint: fp, source: row.source, status: row.status, created_at: row.created_at, draft: JSON.parse(row.draft_json) });
    } finally { db.close(); }
  },

  'redact-check'() {
    const file = arg('file');
    if (!file) fail('missing --file');
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      fail('cannot read file: ' + err.message);
    }
    const findings = redact.findSecrets(text);
    if (findings.length > 0) {
      out({ clean: false, findings });
      process.exit(3);
    }
    out({ clean: true });
  },

  'fingerprint-text'() {
    const file = arg('file');
    if (!file) fail('missing --file');
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      fail('cannot read file: ' + err.message);
    }
    const norm = normalize.normalizePrompt(text);
    out({ fingerprint: crypto.createHash('sha256').update(norm).digest('hex').slice(0, 12) });
  },

  'config-get'() {
    out(configMod.load());
  },

  'config-set'() {
    const key = arg('key');
    const value = arg('value');
    if (!key || value === null) fail('need --key and --value');
    out(configMod.set(key, value));
  },

  run() {
    // Synchronous worker pass (setup backfill and tests use this).
    const workerPath = path.join(__dirname, 'worker.js');
    const args = [workerPath];
    if (process.argv.includes('--deep')) args.push('--deep');
    const res = spawnSync(process.execPath, args, {
      stdio: 'ignore',
      env: process.env,
      timeout: 10 * 60 * 1000
    });
    const db = dbMod.available() ? dbMod.open(paths.dbPath()) : null;
    try {
      out({
        ok: res.status === 0,
        last_run_at: db ? dbMod.getMeta(db, 'last_run_at') : null,
        deep_remaining: db ? dbMod.getMeta(db, 'deep_remaining') : null
      });
    } finally { if (db) db.close(); }
  }
};

function main() {
  const cmd = process.argv[2];
  if (!cmd || !commands[cmd]) {
    fail('usage: cli.js <' + Object.keys(commands).join('|') + '> [--flags]');
  }
  try {
    commands[cmd]();
  } catch (err) {
    fail((err && err.message) || String(err));
  }
}

main();
