'use strict';

// Synthetic transcript builder for tests. Everything here is invented:
// fake session ids, fake project paths, fake prompts, planted markers.
// NEVER derive fixture content from real session logs (CLAUDE.md rule 7).

const fs = require('fs');
const path = require('path');

const FAKE_CWD = '/home/tester/fakerepo';

function ts(day, h, m) {
  return day + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00.000Z';
}

function userLine(text, day, h, m, cwd) {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    timestamp: ts(day, h, m),
    cwd: cwd || FAKE_CWD,
    sessionId: 'synthetic'
  };
}

function toolResultLine(marker, day, h, m) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: marker }]
    },
    timestamp: ts(day, h, m),
    cwd: FAKE_CWD
  };
}

function assistantLine(toolName, input, day, h, m, extraText) {
  const content = [];
  if (extraText) content.push({ type: 'text', text: extraText });
  if (toolName) content.push({ type: 'tool_use', id: 'tu1', name: toolName, input: input || {} });
  return {
    type: 'assistant',
    message: { role: 'assistant', content },
    timestamp: ts(day, h, m),
    cwd: FAKE_CWD
  };
}

// A complete synthetic session for a named process family with varying
// inputs. tools: array of tool names used in order.
function processSession(opts) {
  const day = opts.day;
  const lines = [];
  let minute = 0;
  for (let i = 0; i < opts.prompts.length; i++) {
    lines.push(userLine(opts.prompts[i], day, 9, minute++));
    for (const tool of (opts.toolsPerPrompt && opts.toolsPerPrompt[i]) || []) {
      lines.push(assistantLine(tool, { arg: 'value-' + minute }, day, 9, minute++, 'ASSISTANT-TEXT-NEVER-STORED'));
      lines.push(toolResultLine('TOOL-RESULT-NEVER-STORED ' + tool, day, 9, minute++));
    }
  }
  lines.push({ type: 'summary', summary: 'synthetic summary', leafUuid: 'x' });
  return lines;
}

function writeTranscript(dir, sessionId, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, sessionId + '.jsonl');
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

// The canonical "weekly release notes" family: same process, varying
// version / file / channel per run.
function releaseNotesSession(n, day, version, file, channel) {
  return processSession({
    day,
    prompts: [
      'Draft the weekly release notes for v' + version + ' using ' + file + ' and summarize the merged changes',
      'Publish the notes to the ' + channel + ' channel and tag version ' + version
    ],
    toolsPerPrompt: [['Read', 'Bash'], ['Write']]
  });
}

// An unrelated one-off session (should never cluster with the family).
function unrelatedSession(day, topic) {
  return processSession({
    day,
    prompts: ['Investigate the ' + topic + ' and explain the root cause in detail'],
    toolsPerPrompt: [['Grep']]
  });
}

module.exports = {
  FAKE_CWD,
  ts,
  userLine,
  toolResultLine,
  assistantLine,
  processSession,
  writeTranscript,
  releaseNotesSession,
  unrelatedSession
};
