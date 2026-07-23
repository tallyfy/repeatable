---
name: setup
description: One-time guided setup for Repeatable - check prerequisites (Node 22.13+), connect the Tallyfy MCP server (mcp.tallyfy.com), print the privacy summary, tune detection thresholds, and optionally index existing session history. Use when the user asks to set up, configure, or connect Repeatable or its Tallyfy connection.
---

# Repeatable setup

Guided, one-time configuration. Be brief and concrete; ask one thing at a
time. Prefer a structured multiple-choice question tool if available.

## Step 1: prerequisites

Run:

```
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" doctor
```

- If the command itself fails (node not found): tell the user Repeatable
  needs Node.js 22.13 or newer on PATH (Node 24 LTS recommended), point
  to https://nodejs.org, and stop. Until then the plugin stays inert.
- If `node_sqlite_available` is false: the installed Node is too old;
  same guidance, stop.
- If `data_dir_writable` is false: report the `data_dir` path and stop.

## Step 2: the privacy summary (print verbatim)

Print exactly this before anything else happens:

```
Repeatable privacy summary
1. Everything stays on your machine until you approve a specific
   proposal. Detection and indexing make zero network calls.
2. Only that approved procedure text (title, steps, form fields, tags)
   goes to your Tallyfy account. Never transcripts, never tool output,
   never file contents.
3. No telemetry. The plugin phones nothing home, ever.
Full details: PRIVACY.md in the plugin repository.
```

## Step 3: Tallyfy MCP connection

The plugin bundles the Tallyfy MCP server (https://mcp.tallyfy.com/mcp).
Check whether Tallyfy MCP tools (for example `get_template`,
`create_template`) are available in this session:

- If available and authenticated: confirm by calling a cheap read-only
  tool (for example listing templates) and report success.
- If the server is present but not authenticated: tell the user to run
  `/mcp` and complete the Tallyfy OAuth sign-in, then re-run setup.
- If the server is absent entirely: give the manual fallback:

  ```
  claude mcp add --transport http tallyfy https://mcp.tallyfy.com/mcp
  ```

- If the user has no Tallyfy account, that is fine: detection and
  review still work; only the push step needs Tallyfy. Note it and move
  on.

## Step 4: thresholds

Show current values from doctor output (`config`), then ask whether to
keep defaults or adjust:

- `min_sessions` (default 3) and `min_days` (default 2): how much
  repetition counts as a process
- `ignore_projects`: any directories to never index

Write changes with:

```
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" config-set --key min_sessions --value 3
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" config-set --key ignore_projects --value '["/path/to/private-project"]'
```

Only set what the user changed. Defaults need no writes.

## Step 5: history backfill (optional, recommended)

Offer to index existing session history now (default yes). If accepted:

```
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" run --deep
```

This is bounded to 500 sessions per run. If the result shows
`deep_remaining` above zero, offer to run it again until it reaches zero
(or let future session-end hooks catch up naturally).

## Step 6: wrap up

Run the status command and summarize: what is indexed, whether any
clusters already qualify, and that from now on detection runs by itself
after every session with no scheduler needed. Point at
`/repeatable:review` and `/repeatable:status`.
