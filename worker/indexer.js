'use strict';

// Turns one transcript into one sessions row. Enforces the storage
// allowlist (PRIVACY.md): what goes into the row is redacted prompts,
// tool names + argument digests, timing, and counts. Nothing else.

const fs = require('fs');
const path = require('path');
const parser = require('./parser');
const redact = require('./redact');
const normalize = require('./normalize');
const minhash = require('./minhash');
const db = require('./db');

function projectKey(cwd) {
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : 'unknown';
}

function durationSeconds(startedAt, endedAt) {
  if (!startedAt || !endedAt) return 0;
  const a = Date.parse(startedAt);
  const b = Date.parse(endedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, (b - a) / 1000);
}

function ignored(cwd, config) {
  const list = (config && config.ignore_projects) || [];
  if (!cwd) return false;
  return list.some((p) => typeof p === 'string' && p.length > 0 && cwd.startsWith(p));
}

// Index one session into the DB. entry: {session_id, transcript_path, cwd}
// Returns the stored status.
function indexSession(database, entry, config) {
  const sessionId = String(entry.session_id || '');
  if (!sessionId) return 'skipped';

  const base = {
    session_id: sessionId,
    cwd: entry.cwd || null,
    project: projectKey(entry.cwd),
    transcript_path: entry.transcript_path || null
  };

  if (ignored(entry.cwd, config)) {
    db.upsertSession(database, Object.assign({}, base, { status: 'ignored' }));
    return 'ignored';
  }

  if (!entry.transcript_path) {
    db.upsertSession(database, Object.assign({}, base, { status: 'missing' }));
    return 'missing';
  }

  const parsed = parser.parseTranscript(entry.transcript_path);

  // Deep-scan entries have no cwd; the transcript itself carries one.
  if (!base.cwd && parsed.cwd) {
    base.cwd = parsed.cwd;
    base.project = projectKey(parsed.cwd);
    if (ignored(parsed.cwd, config)) {
      db.upsertSession(database, Object.assign({}, base, { status: 'ignored' }));
      return 'ignored';
    }
  }

  if (parsed.status === 'missing' || parsed.status === 'parse_failed') {
    db.upsertSession(database, Object.assign({}, base, {
      status: parsed.status,
      started_at: parsed.startedAt,
      ended_at: parsed.endedAt,
      content_bytes: parsed.contentBytes,
      prompt_count: 0,
      tool_call_count: 0
    }));
    return parsed.status;
  }

  // ALLOWLIST enforcement point: only these fields leave the parser.
  const prompts = parsed.prompts.map((p) => redact.redactText(p));
  const toolSeq = parsed.toolCalls.map((c) => c.name);
  const toolCalls = parsed.toolCalls.map((c) => ({ name: c.name, digest: c.digest, ts: c.ts }));

  const trivialCfg = (config && config.trivial) || { min_prompts: 1, min_duration_seconds: 60 };
  const dur = durationSeconds(parsed.startedAt, parsed.endedAt);
  const isTrivial =
    prompts.length < trivialCfg.min_prompts ||
    (toolSeq.length === 0 && dur < trivialCfg.min_duration_seconds);

  let minhashJson = null;
  if (!isTrivial) {
    const normText = prompts.map((p) => normalize.normalizePrompt(p)).join(' | ');
    const sig = minhash.signature(normalize.shingles(normText, 3));
    minhashJson = sig ? JSON.stringify(sig) : null;
  }

  db.upsertSession(database, Object.assign({}, base, {
    status: isTrivial ? 'trivial' : 'indexed',
    started_at: parsed.startedAt,
    ended_at: parsed.endedAt,
    prompt_count: prompts.length,
    tool_call_count: toolSeq.length,
    content_bytes: parsed.contentBytes,
    prompts_json: JSON.stringify(prompts),
    toolseq_json: JSON.stringify({ seq: toolSeq, calls: toolCalls }),
    minhash_json: minhashJson
  }));
  return isTrivial ? 'trivial' : 'indexed';
}

// Should this transcript be (re)indexed? True when unknown or grown.
function needsIndexing(database, sessionId, transcriptPath) {
  const row = db.getSession(database, sessionId);
  if (!row) return true;
  try {
    const size = fs.statSync(transcriptPath).size;
    return size > (row.content_bytes || 0);
  } catch (_) {
    return false;
  }
}

// Discover session JSONL files under the projects root (deep scan).
function discoverTranscripts(projectsRoot) {
  const found = [];
  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(projectsRoot);
  } catch (_) {
    return found;
  }
  for (const dir of projectDirs) {
    const full = path.join(projectsRoot, dir);
    let files = [];
    try {
      if (!fs.statSync(full).isDirectory()) continue;
      files = fs.readdirSync(full);
    } catch (_) {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(full, f);
      let mtime = 0;
      try {
        mtime = fs.statSync(p).mtimeMs;
      } catch (_) {
        continue;
      }
      found.push({
        session_id: f.slice(0, -'.jsonl'.length),
        transcript_path: p,
        project_dir: dir,
        mtime
      });
    }
  }
  found.sort((a, b) => a.mtime - b.mtime || (a.session_id < b.session_id ? -1 : 1));
  return found;
}

module.exports = { indexSession, needsIndexing, discoverTranscripts, ignored, projectKey };
