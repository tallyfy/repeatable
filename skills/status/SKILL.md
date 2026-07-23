---
name: status
description: Show what Repeatable has indexed locally, which repeated-session clusters are forming or ready for review, what has been pushed to Tallyfy, and any parse warnings. Use when the user asks about Repeatable status, detected processes, or why nothing has been detected yet.
---

# Repeatable status

Show the user a clear picture of the local index and detection state.

## Steps

1. Run:

   ```
   node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" status
   ```

2. If the output contains `runtime_warning`, explain it plainly: the
   plugin needs Node.js 22.13 or newer on PATH, nothing is being indexed
   until then, and `/repeatable:setup` walks through the fix. Stop here.

3. Otherwise present, in this order, as compact prose or a small table
   (no walls of JSON):
   - Index counts: indexed / trivial / ignored / missing / parse_failed
     sessions, and when the worker last ran.
   - If `parse_warning` is set, show it verbatim. It means the Claude
     Code transcript format may have changed and the plugin needs an
     update.
   - `candidates`: clusters ready for review. For each: title hint,
     session count, day span, project. Tell the user to run
     `/repeatable:review` to draft one.
   - `forming`: clusters that exist but have not yet crossed the
     thresholds (need at least `min_sessions` sessions across at least
     `min_days` days). Show what they are waiting for.
   - `pushed`: blueprints already created in Tallyfy, with their
     fingerprints.

4. If the index is empty or tiny, say so honestly: detection needs a few
   days of normal Claude Code use, or the user can index existing history
   now by running a deep scan:

   ```
   node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" run --deep
   ```

   The deep scan is bounded (500 sessions per run); if the output shows
   `deep_remaining` above zero, offer to run it again to continue.

## Privacy note

Everything this command reads is local. Do not send any of it anywhere.
