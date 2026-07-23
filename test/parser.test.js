'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const parser = require('../worker/parser');
const synth = require('./helpers/synth');

const FIXTURES = path.join(__dirname, 'fixtures');

test('gen1 fixture: extracts prompts and tool calls, excludes results and commands', () => {
  const r = parser.parseTranscript(path.join(FIXTURES, 'gen1-invoice.jsonl'));
  assert.strictEqual(r.status, 'ok');
  // Two human prompts; the tool_result carrier and the <command-name>
  // wrapper are NOT prompts.
  assert.strictEqual(r.prompts.length, 2);
  assert.match(r.prompts[0], /monthly invoice rollup/);
  assert.match(r.prompts[1], /Email the rollup/);
  // Tool calls in order with digests
  assert.deepStrictEqual(r.toolCalls.map((c) => c.name), ['Read', 'Bash']);
  for (const c of r.toolCalls) assert.match(c.digest, /^[0-9a-f]{12}$/);
  // Allowlist: no tool results or assistant text anywhere in the output
  const flat = JSON.stringify(r);
  assert.ok(!flat.includes('TOOL-RESULT-NEVER-STORED'));
  assert.ok(!flat.includes('ASSISTANT-TEXT-NEVER-STORED'));
  // Timing + cwd metadata
  assert.strictEqual(r.cwd, '/home/tester/fakerepo');
  assert.ok(r.startedAt < r.endedAt);
});

test('gen2 fixture: unknown fields and entry types are tolerated noise', () => {
  const r = parser.parseTranscript(path.join(FIXTURES, 'gen2-future.jsonl'));
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.prompts.length, 2);
  assert.deepStrictEqual(r.toolCalls.map((c) => c.name), ['Grep', 'Write']);
  // Unknown entry TYPES are recognized-ignored (otherTypes), never skips:
  // the transcript format grows auxiliary types on any release.
  assert.strictEqual(r.skipped, 0);
  assert.ok(r.otherTypes >= 1);
});

test('a transcript dominated by auxiliary types still parses ok (real-world shape)', () => {
  // Mirrors the observed real composition: many auxiliary entries per
  // human prompt (attachment, mode, last-prompt, queue-operation, ...).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-parser-'));
  const aux = ['attachment', 'mode', 'permission-mode', 'last-prompt', 'pr-link', 'queue-operation', 'ai-title', 'agent-name', 'system'];
  const lines = [synth.userLine('the only human prompt here', '2026-07-04', 9, 0)];
  for (let i = 0; i < 30; i++) {
    lines.push({ type: aux[i % aux.length], timestamp: synth.ts('2026-07-04', 9, i + 1), whatever: i });
  }
  const p = synth.writeTranscript(dir, 's-aux', lines);
  const r = parser.parseTranscript(p);
  assert.strictEqual(r.status, 'ok', 'auxiliary types must never trip the fail-loud ratio');
  assert.deepStrictEqual(r.prompts, ['the only human prompt here']);
  assert.strictEqual(r.otherTypes, 30);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('malformed user/assistant message shapes count toward fail-loud', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-parser-'));
  const lines = [
    { type: 'user', message: { content: 42 } },
    { type: 'user', note: 'no message' },
    { type: 'assistant', message: { role: 'assistant', content: 'not an array' } }
  ];
  const p = synth.writeTranscript(dir, 's-malformed', lines);
  const r = parser.parseTranscript(p);
  assert.strictEqual(r.skipped, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('corrupted fixture: fail-loud parse_failed past 20 percent skips', () => {
  const r = parser.parseTranscript(path.join(FIXTURES, 'corrupted.jsonl'));
  assert.strictEqual(r.status, 'parse_failed');
  assert.ok(r.skipped / r.lineCount > 0.2);
  assert.match(r.note, /log format may have changed/);
});

test('missing transcript reports missing, never throws', () => {
  const r = parser.parseTranscript(path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.jsonl'));
  assert.strictEqual(r.status, 'missing');
});

test('array-content prompts join text items and skip tool_result carriers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-parser-'));
  const lines = [
    synth.userLine('plain string prompt', '2026-07-03', 9, 0),
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'first part' }, { type: 'text', text: 'second part' }] },
      timestamp: '2026-07-03T09:01:00.000Z',
      cwd: synth.FAKE_CWD
    },
    synth.toolResultLine('NEVER-A-PROMPT', '2026-07-03', 9, 2)
  ];
  const p = synth.writeTranscript(dir, 's-array', lines);
  const r = parser.parseTranscript(p);
  assert.deepStrictEqual(r.prompts, ['plain string prompt', 'first part\nsecond part']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('meta entries are not prompts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-parser-'));
  const meta = synth.userLine('this is meta', '2026-07-03', 9, 0);
  meta.isMeta = true;
  const p = synth.writeTranscript(dir, 's-meta', [meta, synth.userLine('real prompt', '2026-07-03', 9, 1)]);
  const r = parser.parseTranscript(p);
  assert.deepStrictEqual(r.prompts, ['real prompt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('argDigest is stable across key order', () => {
  const a = parser.argDigest({ x: 1, y: { b: 2, a: 3 } });
  const b = parser.argDigest({ y: { a: 3, b: 2 }, x: 1 });
  assert.strictEqual(a, b);
});
