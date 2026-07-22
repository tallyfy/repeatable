'use strict';

// Secret redaction. Runs at two gates (see PRIVACY.md):
//   1. ingest: every user prompt is redacted before it is stored
//   2. outbound: every proposal is checked again before it is shown/pushed
//
// Philosophy: cheap, deterministic, and biased toward redacting too much
// rather than too little. Prompts are still useful for similarity with a
// few [REDACTED] holes in them.

const REDACTED = '[REDACTED]';

// Ordered: multi-line PEM blocks first, then structured tokens, then
// generic bearer strings, then the entropy net.
const PATTERNS = [
  // PEM private key blocks (multi-line)
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  // JWT: three base64url segments, first one starting eyJ
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
  // Bare long eyJ blob (partial JWT pastes)
  /\beyJ[A-Za-z0-9_-]{20,}\b/g,
  // AWS access key id
  /\bAKIA[0-9A-Z]{16}\b/g,
  // AWS-style secret assignment (aws_secret_access_key = ...)
  /\b(aws_secret_access_key|aws_session_token)\s*[=:]\s*[A-Za-z0-9+/=]{20,}/gi,
  // GitHub tokens (classic and fine-grained)
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // GitLab personal access token
  /\bglpat-[A-Za-z0-9_-]{15,}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // Google API key
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // OpenAI / Anthropic style keys (sk-..., sk-ant-...)
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  // Stripe keys
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  // npm token
  /\bnpm_[A-Za-z0-9]{30,}\b/g,
  // SendGrid
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  // Generic bearer header value
  /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  // key=value style assignments for obvious secret names
  /\b(api[_-]?key|apikey|secret|token|password|passwd|client[_-]?secret)\s*[=:]\s*["']?[A-Za-z0-9._~+/-]{12,}["']?/gi
];

function shannonEntropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// Catch-all: long, high-entropy, base64ish tokens that slipped past the
// structured patterns. Threshold tuned to leave prose and identifiers
// (UUIDs, git SHAs are hex and lower-entropy) alone.
function redactHighEntropy(text) {
  return text.replace(/[A-Za-z0-9+/=_-]{32,}/g, (tok) => {
    // Pure hex (git SHAs, UUIDs without dashes) is handled by
    // normalization, not treated as a secret.
    if (/^[0-9a-f-]+$/i.test(tok)) return tok;
    const hasUpper = /[A-Z]/.test(tok);
    const hasLower = /[a-z]/.test(tok);
    const hasDigit = /[0-9]/.test(tok);
    const classes = (hasUpper ? 1 : 0) + (hasLower ? 1 : 0) + (hasDigit ? 1 : 0);
    if (classes < 2) return tok;
    if (shannonEntropy(tok) < 4.2) return tok;
    return REDACTED;
  });
}

function redactText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  out = redactHighEntropy(out);
  return out;
}

// Findings mode for the outbound gate: returns a list of {pattern, sample}
// hits WITHOUT redacting, so the review flow can show the user what was
// caught and refuse to proceed.
function findSecrets(text) {
  const findings = [];
  if (typeof text !== 'string' || text.length === 0) return findings;
  PATTERNS.forEach((re, i) => {
    const fresh = new RegExp(re.source, re.flags);
    let m;
    while ((m = fresh.exec(text)) !== null) {
      findings.push({ pattern: 'p' + i, sample: m[0].slice(0, 8) + '...' });
      if (findings.length > 50) return;
    }
  });
  // Entropy net
  const entropyRe = /[A-Za-z0-9+/=_-]{32,}/g;
  let m;
  while ((m = entropyRe.exec(text)) !== null) {
    const tok = m[0];
    if (/^[0-9a-f-]+$/i.test(tok)) continue;
    const hasUpper = /[A-Z]/.test(tok);
    const hasLower = /[a-z]/.test(tok);
    const hasDigit = /[0-9]/.test(tok);
    if ((hasUpper ? 1 : 0) + (hasLower ? 1 : 0) + (hasDigit ? 1 : 0) < 2) continue;
    if (shannonEntropy(tok) < 4.2) continue;
    findings.push({ pattern: 'entropy', sample: tok.slice(0, 8) + '...' });
    if (findings.length > 50) break;
  }
  return findings;
}

module.exports = { redactText, findSecrets, REDACTED };
