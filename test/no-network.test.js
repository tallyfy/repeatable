'use strict';

// The privacy suite's teeth (PRIVACY.md "Enforcement, not promises").
//
// Dynamic half: trap every Node network entry point BEFORE loading the
// worker modules, run the full capture-index-cluster pipeline over
// synthetic fixtures, and assert zero network attempts. The node --test
// runner executes each test file in its own process, so these traps see
// everything the pipeline does.
//
// Static half: assert that hook and worker sources never even mention
// the network modules.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const attempts = [];

function trap(mod, modName, fnNames) {
  for (const fn of fnNames) {
    if (typeof mod[fn] === 'function') {
      mod[fn] = function () {
        attempts.push(modName + '.' + fn);
        throw new Error('network attempted: ' + modName + '.' + fn);
      };
    }
  }
}

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const dns = require('dns');

trap(http, 'http', ['request', 'get']);
trap(https, 'https', ['request', 'get']);
trap(net, 'net', ['connect', 'createConnection']);
trap(tls, 'tls', ['connect']);
trap(dns, 'dns', ['lookup', 'resolve', 'resolve4', 'resolve6']);
net.Socket.prototype.connect = function () {
  attempts.push('net.Socket.connect');
  throw new Error('network attempted: socket connect');
};
globalThis.fetch = function () {
  attempts.push('fetch');
  return Promise.reject(new Error('network attempted: fetch'));
};

// Load the pipeline AFTER the traps.
const dbMod = require('../worker/db');
const indexer = require('../worker/indexer');
const cluster = require('../worker/cluster');
const configMod = require('../worker/config');
const redact = require('../worker/redact');
const synth = require('./helpers/synth');

test('canary: the traps actually fire', () => {
  assert.throws(() => http.get('http://example.invalid'), /network attempted/);
  assert.strictEqual(attempts.length, 1);
  attempts.length = 0;
});

test('full pipeline makes zero network calls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-nonet-'));
  const database = dbMod.open(path.join(dir, 'repeatable.db'));
  const days = ['2026-07-01', '2026-07-08', '2026-07-15'];
  for (let i = 0; i < 3; i++) {
    const p = synth.writeTranscript(dir, 'nn-' + i,
      synth.releaseNotesSession(i, days[i], '12.' + i + '.0', 'CHANGELOG.md', 'stable'));
    indexer.indexSession(database, { session_id: 'nn-' + i, transcript_path: p, cwd: synth.FAKE_CWD }, configMod.DEFAULTS);
  }
  cluster.recluster(database, configMod.DEFAULTS);
  redact.redactText('probe ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234 probe');
  database.close();
  assert.deepStrictEqual(attempts, [], 'network attempted during the pipeline: ' + attempts.join(', '));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('static: hook and worker sources contain no network client code', () => {
  const roots = [
    path.join(__dirname, '..', 'scripts'),
    path.join(__dirname, '..', 'worker')
  ];
  const banned = [
    /require\(\s*['"](node:)?https?['"]\s*\)/,
    /require\(\s*['"](node:)?net['"]\s*\)/,
    /require\(\s*['"](node:)?tls['"]\s*\)/,
    /require\(\s*['"](node:)?dns['"]\s*\)/,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /WebSocket/
  ];
  for (const root of roots) {
    for (const f of fs.readdirSync(root)) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      for (const re of banned) {
        assert.ok(!re.test(src), root + '/' + f + ' matches banned pattern ' + re);
      }
    }
  }
});
