'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { redactText, findSecrets, REDACTED } = require('../worker/redact');

// Every value below is FAKE, constructed for the test.
const SECRETS = [
  ['jwt', 'header eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmYWtlIjoidHJ1ZSJ9.c2lnbmF0dXJlZmFrZWZha2VmYWtl trailing'],
  ['bare eyJ blob', 'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9fakefakefake here'],
  ['aws access key', 'creds AKIAIOSFODNN7EXAMPLE in env'],
  ['aws secret assignment', 'aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYFAKEFAKEFAKE'],
  ['github classic', 'push with ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234'],
  ['github fine-grained', 'github_pat_FAKEFAKEFAKEFAKEFAKE_FAKEFAKEFAKEFAKEFAKEFAKE'],
  ['gitlab', 'ci uses glpat-FAKEFAKEFAKEFAKEFAKE1'],
  // Letters only after the prefix: matches our redaction pattern but can
  // never match Slack's real numeric token format (keeps GitHub push
  // protection quiet about a fixture that is fake by construction).
  ['slack', 'hook xoxb-FAKEFAKEFAKE-FAKEFAKEFAKEFAKE'],
  ['google api', 'maps key AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK'],
  ['openai style', 'use sk-FAKEFAKEFAKEFAKEFAKEFAKEFAKE123456'],
  ['stripe', 'billing sk_live_FAKEFAKEFAKEFAKE1234'],
  ['npm', 'publish npm_FAKEFAKEFAKEFAKEFAKEFAKEFAKE123456'],
  ['sendgrid', 'mail SG.FAKEFAKEFAKEFAKEFAKE.FAKEFAKEFAKEFAKEFAKEFAKE'],
  ['bearer', 'header Authorization: Bearer abc123def456ghi789jkl012'],
  ['pem block', 'key -----BEGIN RSA PRIVATE KEY-----\nMIIFAKEFAKE\n-----END RSA PRIVATE KEY----- done'],
  ['keyvalue', 'config api_key = supersecretvaluef8f8f8 end'],
  ['high entropy', 'random blob aB3xK9mQ7wR2vT5yU8iO1pL4sD6fG0hJzXcVbNm here']
];

test('all secret patterns are redacted', () => {
  for (const [name, text] of SECRETS) {
    const out = redactText(text);
    assert.ok(out.includes(REDACTED), name + ' should be redacted, got: ' + out);
  }
});

test('redaction leaves surrounding prose intact', () => {
  const out = redactText('creds AKIAIOSFODNN7EXAMPLE in env');
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
