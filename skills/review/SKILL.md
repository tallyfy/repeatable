---
name: review
description: Review Repeatable's detected repeated-session clusters, draft a full Tallyfy procedure for one (title, ordered steps, kick-off form fields, AI-step hints), and on explicit user approval push it to Tallyfy via the Tallyfy MCP server. Use when the user wants to review detected processes, turn repeated sessions into a procedure, or push a detected process to Tallyfy.
---

# Repeatable review

Turn a detected cluster of similar sessions into a Tallyfy procedure the
user approves before anything leaves the machine.

Hard rules:
- NOTHING is created in Tallyfy without the user's explicit approval of
  the rendered draft in this conversation.
- The draft may only contain material from the cluster's prompts and tool
  names, generalized. Never quote tool results or file contents into it.
- If the redaction gate reports findings, stop and show them; do not push.

## Step 1: list candidates

```
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" pending
```

If empty: explain that detection needs at least `min_sessions` similar
sessions across `min_days` days, suggest `/repeatable:status` to see
clusters forming, and stop.

Otherwise show a numbered list (title hint, session count, day span,
project) and ask which cluster to draft. If a cluster's status is already
`proposed`, offer to resume it (fetch the saved draft with the `proposal`
command instead of redrafting).

## Step 2: gather evidence

```
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" cluster --fingerprint <fp>
```

For each member where `transcript_still_on_disk` is true, you may Read
the original transcript for fidelity, but use ONLY user-role prompt text
and tool names from it; ignore tool results, file contents, and
assistant messages entirely. Where transcripts are gone, the indexed
`prompts` and `tool_sequence` are the evidence.

## Step 3: draft

Follow the drafting instructions in
`${CLAUDE_PLUGIN_ROOT}/skills/review/references/drafting-prompt.md`
and produce a proposal JSON that conforms to
`${CLAUDE_PLUGIN_ROOT}/skills/review/references/proposal-schema.md`
with `source` set to `detected` and the cluster's fingerprint.

## Step 4: redaction gate, then save

Write the draft JSON to a file inside the plugin data directory (take
`data_dir` from the doctor command; use `<data_dir>/proposals/<fp>.draft.json`),
then:

```
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" save-proposal --fingerprint <fp> --file <that file> --source detected
```

Exit code 3 means secrets were detected: show the findings, remove the
offending content from the draft, and retry. Never push a draft that
fails this gate.

## Step 5: render for approval

Show the user a compact review, not raw JSON:

- Title and one-line summary
- Kick-off fields as a table: label, type, required, options, and the
  one-line evidence for why it varies
- Numbered steps with their descriptions; mark `executor_hint: ai` steps
  with "[Suggested AI step]"

Then ask exactly one question with three options: approve and push to
Tallyfy / edit the draft / dismiss this cluster.

- Edit: apply the user's changes, re-run Step 4, re-render.
- Dismiss:
  ```
  node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" mark --fingerprint <fp> --status dismissed
  ```
  Confirm it will not be proposed again unless it roughly doubles in
  occurrences. Stop.
- Approve: mark it proposed, then push:
  ```
  node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" mark --fingerprint <fp> --status proposed
  ```

## Step 6: push to Tallyfy

Follow `${CLAUDE_PLUGIN_ROOT}/skills/review/references/push-runbook.md`
exactly. It covers dedupe (never create a duplicate blueprint for a
fingerprint), the create path, the update path with the drift guard, and
the final bookkeeping (`mark --status pushed --blueprint-id ...
--checksum ...`).

If Tallyfy MCP tools are not available in this session, do not fail the
whole flow: the approved draft is already saved locally; tell the user
to run `/repeatable:setup` to connect Tallyfy, after which review can
resume the push.

## Step 7: confirm

Show the blueprint link returned by the push, restate that only the
approved procedure text was sent, and mention that future detections of
this same process will propose an update to this blueprint rather than a
duplicate.
