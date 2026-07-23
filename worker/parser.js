'use strict';

// Defensive parser for Claude Code session transcripts (JSONL).
//
// The transcript entry format is INTERNAL to Claude Code and can change on
// any release (stated in the official sessions doc). So this parser:
//   - checks marker fields per line and only extracts shapes it recognizes
//   - counts every line it cannot interpret
//   - marks the whole session parse_failed past a 20 percent skip ratio
//     (fail loud: /repeatable:status surfaces it as "the log format may
//     have changed; update the plugin")
//   - never throws to the caller
//
// ALLOWLIST (PRIVACY.md rule 2): the parser extracts ONLY
//   - user prompts (human text; redacted before storage by the caller)
//   - tool call names + a one-way digest of arguments + timestamps
//   - session timing metadata
// It never returns tool results, file contents, assistant text, or images.

const fs = require('fs');
const crypto = require('crypto');

const MAX_BYTES = 64 * 1024 * 1024; // 64 MB safety cap
const SKIP_RATIO_LIMIT = 0.2;
const MIN_LINES_FOR_RATIO = 10;

// Version pinning philosophy (calibrated against real transcripts,
// 2026-07, Claude Code 2.1.218): transcripts contain many auxiliary
// entry types beyond user/assistant (observed: attachment, mode,
// permission-mode, last-prompt, pr-link, queue-operation, ai-title,
// system, agent-name, file-history-snapshot, summary, ...), and new ones
// appear across releases. Unknown TYPES are therefore recognized-ignored
// noise, counted in `otherTypes`, never failures. The fail-loud skip
// ratio pins what extraction actually depends on: lines that do not
// parse as JSON objects with a string `type`, and user/assistant entries
// whose message shape (role + content) is not one we understand. If that
// inner shape changes on a release, sessions go `parse_failed` and
// /repeatable:status says so.

// Text wrappers that are not human prompts even though they arrive as
// user-role entries: slash-command envelopes, command output echoes,
// injected reminders.
const NON_HUMAN_PREFIXES = [
  '<command-name>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<system-reminder>',
  '<command-message>'
];

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function argDigest(input) {
  try {
    return crypto.createHash('sha256').update(stableStringify(input === undefined ? null : input)).digest('hex').slice(0, 12);
  } catch (_) {
    return 'digest-error';
  }
}

function isNonHumanText(text) {
  const t = text.trimStart();
  return NON_HUMAN_PREFIXES.some((p) => t.startsWith(p));
}

// Extract the human prompt text from a user entry, or null when the entry
// is not a human prompt (tool results, command wrappers, meta entries).
function humanPromptFrom(entry) {
  if (entry.isMeta === true) return null;
  const msg = entry.message;
  if (!msg || msg.role !== 'user') return null;
  const content = msg.content;
  if (typeof content === 'string') {
    if (content.length === 0 || isNonHumanText(content)) return null;
    return content;
  }
  if (Array.isArray(content)) {
    // A tool_result carrier is not a human prompt.
    if (content.some((c) => c && c.type === 'tool_result')) return null;
    const texts = content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .filter((t) => t.length > 0 && !isNonHumanText(t));
    if (texts.length === 0) return null;
    return texts.join('\n');
  }
  return null;
}

function toolCallsFrom(entry) {
  const out = [];
  const msg = entry.message;
  if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) return out;
  for (const item of msg.content) {
    if (item && item.type === 'tool_use' && typeof item.name === 'string') {
      out.push({
        name: item.name,
        digest: argDigest(item.input),
        ts: typeof entry.timestamp === 'string' ? entry.timestamp : null
      });
    }
  }
  return out;
}

// Parse a transcript file. Returns:
// {
//   status: 'ok' | 'missing' | 'parse_failed',
//   prompts: [string],            raw human prompts in order (NOT yet redacted)
//   toolCalls: [{name, digest, ts}],
//   startedAt, endedAt: ISO strings or null,
//   lineCount, skipped: numbers,
//   note: string | null
// }
function parseTranscript(transcriptPath) {
  const result = {
    status: 'ok',
    prompts: [],
    toolCalls: [],
    startedAt: null,
    endedAt: null,
    cwd: null,
    lineCount: 0,
    skipped: 0,
    otherTypes: 0,
    contentBytes: 0,
    note: null
  };

  let raw;
  try {
    const stat = fs.statSync(transcriptPath);
    result.contentBytes = stat.size;
    if (stat.size > MAX_BYTES) {
      result.status = 'parse_failed';
      result.note = 'transcript larger than the ' + MAX_BYTES + ' byte cap';
      return result;
    }
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch (_) {
    result.status = 'missing';
    result.note = 'transcript not readable (cleaned up, suppressed, or moved)';
    return result;
  }

  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    result.lineCount++;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (_) {
      result.skipped++;
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      result.skipped++;
      continue;
    }
    if (typeof entry.type !== 'string') {
      result.skipped++;
      continue;
    }

    if (typeof entry.timestamp === 'string') {
      if (result.startedAt === null || entry.timestamp < result.startedAt) result.startedAt = entry.timestamp;
      if (result.endedAt === null || entry.timestamp > result.endedAt) result.endedAt = entry.timestamp;
    }
    if (result.cwd === null && typeof entry.cwd === 'string' && entry.cwd.length > 0) {
      result.cwd = entry.cwd;
    }

    try {
      if (entry.type === 'user') {
        const msg = entry.message;
        if (!msg || msg.role !== 'user' ||
            (typeof msg.content !== 'string' && !Array.isArray(msg.content))) {
          // A user entry we cannot read: this is the format-change signal.
          result.skipped++;
          continue;
        }
        const prompt = humanPromptFrom(entry);
        if (prompt !== null) result.prompts.push(prompt);
      } else if (entry.type === 'assistant') {
        const msg = entry.message;
        if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) {
          result.skipped++;
          continue;
        }
        const calls = toolCallsFrom(entry);
        for (const c of calls) result.toolCalls.push(c);
      } else {
        // Auxiliary entry type: recognized-ignored.
        result.otherTypes++;
      }
    } catch (_) {
      result.skipped++;
    }
  }

  if (result.lineCount >= MIN_LINES_FOR_RATIO &&
      result.skipped / result.lineCount > SKIP_RATIO_LIMIT) {
    result.status = 'parse_failed';
    result.note = result.skipped + ' of ' + result.lineCount +
      ' lines unrecognized; the Claude Code log format may have changed. Update the plugin.';
  }

  return result;
}

module.exports = { parseTranscript, argDigest, stableStringify, SKIP_RATIO_LIMIT };
