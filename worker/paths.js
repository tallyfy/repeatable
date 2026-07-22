'use strict';

// Path resolution for the worker. Honors, in order:
//   REPEATABLE_DATA_DIR  (set by enqueue.js when spawning the worker, and by tests)
//   CLAUDE_PLUGIN_DATA   (exported by Claude Code to hook processes)
//   ~/.claude/plugins/data/repeatable  (dev fallback)
// Transcript discovery honors CLAUDE_CONFIG_DIR per the sessions doc.

const os = require('os');
const path = require('path');

function dataDir() {
  if (process.env.REPEATABLE_DATA_DIR) return process.env.REPEATABLE_DATA_DIR;
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA;
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(configDir, 'plugins', 'data', 'repeatable');
}

function projectsRoot() {
  if (process.env.REPEATABLE_PROJECTS_ROOT) return process.env.REPEATABLE_PROJECTS_ROOT;
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(configDir, 'projects');
}

function dbPath() {
  return path.join(dataDir(), 'repeatable.db');
}

function queueDir() {
  return path.join(dataDir(), 'queue');
}

function logsDir() {
  return path.join(dataDir(), 'logs');
}

function configPath() {
  return path.join(dataDir(), 'config.json');
}

function proposalsDir() {
  return path.join(dataDir(), 'proposals');
}

function lockDir() {
  return path.join(dataDir(), 'worker.lock.d');
}

module.exports = { dataDir, projectsRoot, dbPath, queueDir, logsDir, configPath, proposalsDir, lockDir };
