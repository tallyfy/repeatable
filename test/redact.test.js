'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { redactText, findSecrets, REDACTED } = require('../worker/redact');

// Every value below is FAKE, constructed for the test.
//
// Each one is assembled from pieces at runtime so this file, which ships
// inside the plugin, holds no literal a secret scanner matches. Anthropic's
// directory validator blocked the plugin on exactly that (#13). The strings
// the redactor sees are unchanged.
const j = (...parts) => parts.join('');
const AWS_EXAMPLE = j('AKIA', 'IOSFODNN7EXAMPLE');
const SECRETS = [
  ['jwt', j('header ', 'ey', 'JhbGciOiJIUz', 'I1NiIsInR5cCI6', 'IkpXVCJ9', '.', 'ey', 'JmYWtlIjoidHJ1ZSJ9', '.', 'c2lnbmF0dXJl', 'ZmFrZWZha2VmYWtl', ' trailing')],
  ['bare eyJ blob', j('token ', 'ey', 'JhbGciOiJIUz', 'I1NiIsInR5cCI6', 'IkpXVCJ9', 'fakefakefake here')],
  ['aws access key', j('creds ', AWS_EXAMPLE, ' in env')],
  ['aws secret assignment', j('aws_secret', '_access_key = ', 'wJalrXUtnFEMIK7MDENG', 'bPxRfiCYFAKEFAKEFAKE')],
  ['github classic', j('push with ', 'gh', 'p_', 'FAKEFAKEFAKEFAKE', 'FAKEFAKEFAKEFAKE1234')],
  ['github fine-grained', j('github', '_pat_', 'FAKEFAKEFAKEFAKEFAKE', '_FAKEFAKEFAKEFAKEFAKEFAKE')],
  ['gitlab', j('ci uses ', 'gl', 'pat-', 'FAKEFAKEFAKEFAKEFAKE1')],
  // Letters only after the prefix: matches our redaction pattern but can
  // never match Slack's real numeric token format (keeps GitHub push
  // protection quiet about a fixture that is fake by construction).
  ['slack', j('hook ', 'xo', 'xb-', 'FAKEFAKEFAKE-FAKEFAKEFAKEFAKE')],
  ['google api', j('maps key ', 'AI', 'za', 'FAKEFAKEFAKEFAKEFAKE', 'FAKEFAKEFAKEFAK')],
  ['openai style', j('use ', 's', 'k-', 'FAKEFAKEFAKEFAKE', 'FAKEFAKEFAKE123456')],
  ['stripe', j('billing ', 's', 'k_live_', 'FAKEFAKEFAKEFAKE1234')],
  ['npm', j('publish ', 'np', 'm_', 'FAKEFAKEFAKEFAKE', 'FAKEFAKEFAKE123456')],
  ['sendgrid', j('mail ', 'S', 'G.', 'FAKEFAKEFAKEFAKEFAKE', '.', 'FAKEFAKEFAKEFAKEFAKEFAKE')],
  ['bearer', j('header Authorization: ', 'Bea', 'rer ', 'abc123def456', 'ghi789jkl012')],
  ['pem block', j('key ', '-----BEGIN RSA ', 'PRIVATE KEY-----', '\nMIIFAKEFAKE\n', '-----END RSA ', 'PRIVATE KEY-----', ' done')],
  ['keyvalue', j('config ', 'api', '_key = ', 'supersecretvalue', 'f8f8f8 end')],
  ['high entropy', j('random blob ', 'aB3xK9mQ7wR2vT5yU8iO', '1pL4sD6fG0hJzXcVbNm', ' here')]
];

test('all secret patterns are redacted', () => {
  for (const [name, text] of SECRETS) {
    const out = redactText(text);
    assert.ok(out.includes(REDACTED), name + ' should be redacted, got: ' + out);
  }
});

test('redaction leaves surrounding prose intact', () => {
  const out = redactText(j('creds ', AWS_EXAMPLE, ' in env'));
  assert.strictEqual(out, 'creds ' + REDACTED + ' in env');
});

test('clean text passes through untouched', () => {
  const clean = [
    'Draft the weekly release notes for v2.14.1 and summarize the merged changes',
    'The commit was 9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e and the branch is main',
    'a plain uuid 123e4567-e89b-12d3-a456-426614174000 is fine',
    'ordinary words of considerable length like internationalization'
  ];
  for (const text of clean) {
    assert.strictEqual(redactText(text), text, 'should be untouched: ' + text);
  }
});

test('findSecrets reports findings without redacting, and none after redaction', () => {
  const text = SECRETS.map((s) => s[1]).join('\n');
  const before = findSecrets(text);
  assert.ok(before.length >= SECRETS.length - 2, 'expected many findings, got ' + before.length);
  const after = findSecrets(redactText(text));
  assert.strictEqual(after.length, 0, 'redacted text must scan clean');
});

test('at least 10 distinct secret patterns are covered', () => {
  assert.ok(SECRETS.length >= 10);
});

test('this file ships no literal the redactor would flag', () => {
  // Control on the check itself: the assembled fixtures ARE found above,
  // so an empty result here means the source text is clean, not that the
  // detector is blind.
  const source = require('fs').readFileSync(__filename, 'utf8');
  assert.deepStrictEqual(findSecrets(source), []);
});
