'use strict';

// The environment a Repeatable child process starts with.
//
// Only the variables the worker reads, plus what Node needs to start on
// each platform. Handing a child the whole environment would pass every
// token the user has exported to a process that never needs one, and
// Anthropic's directory validator holds any plugin that does so for
// review (tallyfy/repeatable#13). Both spawn sites use this helper, and
// test/spawn-env.test.js fails if either goes back to the whole object.
//
// Stdlib only. No dependencies.

const KEEP = [
  // Node and the OS
  'PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
  'SystemRoot', 'windir', 'ComSpec', 'PATHEXT',
  // What worker/paths.js and scripts/enqueue.js read
  'CLAUDE_CONFIG_DIR', 'CLAUDE_PLUGIN_DATA',
  'REPEATABLE_DATA_DIR', 'REPEATABLE_PROJECTS_ROOT'
];

function workerEnv(extra) {
  const env = {};
  for (const key of KEEP) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return Object.assign(env, extra || {});
}

module.exports = { workerEnv, KEEP };
