# Privacy

This plugin reads the most sensitive artifact on a developer's machine:
their AI session history. So the privacy posture is simple, absolute, and
enforced by code and tests, not just by promises in prose.

## The three guarantees

1. **Everything stays on your machine until you approve a specific
   proposal.** Detection and indexing make zero network calls.
2. **Only the approved procedure text** (title, summary, step titles and
   descriptions, kick-off form field definitions, tags) **goes to your
   Tallyfy account**, and only at the moment you approve that specific
   proposal. Never your transcripts, never tool output, never file
   contents.
3. **No telemetry.** The plugin phones nothing home, ever. There is no
   analytics code in this repository, no version ping, no crash reporter.

## What leaves the machine, and when

| Data | Destination | When |
|---|---|---|
| Approved proposal text (title, steps, form fields, tags) | Your Tallyfy organization, via the Tallyfy MCP server (mcp.tallyfy.com) | Only on your explicit approval of that proposal |
| Draft conversation content | Anthropic, as part of your own Claude Code session | Only while you run `/repeatable:review` or `/repeatable:import`, under the same terms as all your Claude Code usage |
| Anything else | Nowhere | Never |

The middle row deserves plain words: drafting a proposal happens inside the
Claude Code session you are already in. The plugin adds no new destination
for your data; the drafting conversation is ordinary Claude usage that you
watch happen.

## What is stored locally

The local index lives in the plugin's data directory (managed by Claude
Code; deleted on uninstall). For each session it stores only:

- your user prompts, in order, with obvious secrets stripped (JWT-like
  tokens, common API key formats, high-entropy strings are replaced with
  `[REDACTED]` before storage)
- the sequence of tool names used (for example `Read, Edit, Bash`), plus a
  short one-way digest of tool arguments (a hash, not the arguments)
- timestamps, the project directory path, and counts

It never stores:

- tool results or command output
- file contents
- Claude's replies
- images or attachments

Your original transcripts are Claude Code's own files under `~/.claude`;
this plugin reads them and does not copy them wholesale.

## Controls

- **Per-project opt-out**: add a project to `ignore_projects` in the
  config; its sessions are never indexed.
- **Per-session opt-out**: sessions with transcript persistence disabled
  (Claude Code's `CLAUDE_CODE_SKIP_PROMPT_HISTORY` or
  `--no-session-persistence`) leave no transcript, so they are invisible
  to this plugin too.
- **Uninstall**: `/plugin uninstall repeatable` removes the plugin and its
  data directory (index, queue, config).

## Enforcement, not promises

- The hook and worker code contain no network client code at all. A test
  (`test/no-network.test.js`) stubs Node's network modules and runs the
  full capture-index-cluster pipeline; any socket attempt fails the suite.
- A storage allowlist test indexes fixtures that contain planted tool
  results and file bodies, then checks the database file for that content;
  finding any fails the suite.
- Redaction runs twice: once when a prompt is stored, and again over any
  outbound proposal before it is shown for approval.
- Only the review and import commands can reach Tallyfy MCP tools. The
  background worker cannot: it has no MCP access and no network code.
- Test fixtures in this repository are synthetic, written by hand for the
  tests. No real session data is ever committed.

## Threat notes, honestly

- On multi-user machines, protection of the local index relies on your
  home directory permissions, the same as the transcripts themselves.
- The index is not additionally encrypted in v1. It holds redacted prompt
  text at the same trust level as the plaintext transcripts that already
  sit beside it.
- Supply-chain surface is minimized by design: the plugin has zero runtime
  npm dependencies. The index uses Node's built-in `node:sqlite`.

Questions or concerns: open an issue at
https://github.com/tallyfy/repeatable/issues.
