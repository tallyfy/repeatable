#!/usr/bin/env node
'use strict';

// Repeatable: SessionEnd enqueue hook.
//
// Contract (see issue #2): this process must be instant, silent, and
// unbreakable. Claude Code does not wait for async work in SessionEnd
// hooks when the process exits (anthropics/claude-code#41577), so this
// script does exactly three things and exits 0:
//   1. read the hook payload from stdin (with a hard timeout guard)
//   2. write one small queue file into the plugin data directory
//   3. spawn the detached worker (which does all real parsing) and unref it
//
// Stdlib only. No dependencies. Never throws to the caller.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const STDIN_TIMEOUT_MS = 1500;

function dataDir() {
  // Same resolution order as worker/paths.js (kept inline because this
  // script must stay dependency-free and fast): test override first,
  // then CLAUDE_PLUGIN_DATA (exported by Claude Code to hook processes),
  // then a dev fallback.
  if (process.env.REPEATABLE_DATA_DIR) return process.env.REPEATABLE_DATA_DIR;
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA;
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(configDir, 'plugins', 'data', 'repeatable');
}

function logLine(base, msg) {
  try {
    const dir = path.join(base, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'enqueue.log'), new Date().toISOString() + ' ' + msg + '\n');
  } catch (_) {
    // Logging must never break the hook.
  }
}

function readStdin(cb) {
  let data = '';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cb(data);
  };
  const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
  timer.unref();
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  } catch (_) {
    clearTimeout(timer);
    finish();
  }
}

function main() {
  const base = dataDir();
  readStdin((raw) => {
    try {
      let payload = {};
      try {
        payload = JSON.parse(raw);
      } catch (_) {
        payload = {};
      }
      const sessionId = String(payload.session_id || 'unknown-' + Date.now());
      const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '-');

      const entry = {
        session_id: sessionId,
        transcript_path: payload.transcript_path || null,
        cwd: payload.cwd || null,
        reason: payload.reason || null,
        enqueued_at: new Date().toISOString()
      };

      const queueDir = path.join(base, 'queue');
      fs.mkdirSync(queueDir, { recursive: true });
      // Last write wins: a session can end more than once (clear/resume);
      // the worker upserts by session_id anyway.
      fs.writeFileSync(path.join(queueDir, safeId + '.json'), JSON.stringify(entry));

      if (process.env.REPEATABLE_NO_SPAWN !== '1') {
        const workerPath = path.join(__dirname, '..', 'worker', 'worker.js');
        // Required here, inside the try, so a missing file can only cost
        // the spawn and never the queue write above (#13).
        const { workerEnv } = require('../worker/env');
        const child = spawn(process.execPath, [workerPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: workerEnv({ REPEATABLE_DATA_DIR: base })
        });
        child.unref();
      }
    } catch (err) {
      logLine(base, 'enqueue error: ' + (err && err.message ? err.message : String(err)));
    }
    process.exit(0);
  });
}

main();
