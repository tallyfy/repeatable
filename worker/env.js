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
// Every variable is read by its literal name, never by a name computed at
// run time, so a reader (or a scanner) can see exactly what is passed on.
//
// Stdlib only. No dependencies.

function workerEnv(extra) {
  const picked = {
    // Node and the OS
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    SystemRoot: process.env.SystemRoot,
    windir: process.env.windir,
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    // What worker/paths.js and scripts/enqueue.js read
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
    REPEATABLE_DATA_DIR: process.env.REPEATABLE_DATA_DIR,
    REPEATABLE_PROJECTS_ROOT: process.env.REPEATABLE_PROJECTS_ROOT
  };
  const env = {};
  for (const [name, value] of Object.entries(picked)) {
    if (value !== undefined) env[name] = value;
  }
  return Object.assign(env, extra || {});
}

// The names workerEnv passes on, for the tests. Read off the source so the
// list cannot drift from what the function actually does.
const KEEP = (function () {
  const src = require('fs').readFileSync(__filename, 'utf8');
  return [...src.matchAll(/^ {4}([A-Za-z_]+): process\.env\.\1,?$/gm)].map((m) => m[1]);
})();

module.exports = { workerEnv, KEEP };
