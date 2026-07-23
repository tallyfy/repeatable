# Repeatable

[![ci](https://github.com/tallyfy/repeatable/actions/workflows/ci.yml/badge.svg)](https://github.com/tallyfy/repeatable/actions/workflows/ci.yml)

Turn your Claude Code sessions into repeatable processes in Tallyfy.

You keep doing the same kind of session: the weekly release, the customer
onboarding checklist, the invoice rollup, the deploy-and-verify dance.
Repeatable notices, drafts it as a proper procedure (a title, ordered steps,
and a kick-off form for the things that change each time), shows you the
draft inside Claude Code, and, only when you approve it, creates it as a
blueprint in your Tallyfy account. Next time, anyone on your team (or an AI
step) can run it, and it runs the same way every time.

It also works for processes you already wrote down: point `/repeatable:import`
at an existing SOP (a Markdown file, a wiki export, a Word doc) and it drafts
the same kind of procedure from that, ready to review and push.

## The privacy promise

1. **Everything stays on your machine** until you approve a specific
   proposal. Detection and indexing make zero network calls.
2. **Only the approved procedure text** (title, steps, form fields, tags)
   goes to your Tallyfy account, and only at the moment you approve it.
   Never your transcripts, never tool output, never file contents.
3. **No telemetry.** The plugin phones nothing home. Not to Tallyfy, not to
   anyone. There is no analytics code in this repository.

The full details, including exactly what is stored locally and what leaves
the machine when, are in [PRIVACY.md](PRIVACY.md).

## What it does

1. **Watches locally.** A tiny hook runs when a Claude Code session ends and
   queues the session for indexing: your prompts, the tool names used, and
   when it happened. Pure local bookkeeping, on your machine.
2. **Detects repetition, with no AI.** Sessions are compared using text
   similarity (MinHash) and tool-sequence matching. That is arithmetic, not
   AI: no API calls, no model, no network. When at least 3 similar sessions
   appear across at least 2 different days (both configurable), that cluster
   becomes a candidate process.
3. **Drafts a procedure.** Run `/repeatable:review`. Claude drafts the full
   procedure in your own session: a title, ordered steps whose descriptions
   come from the prompts you actually used (generalized), and kick-off form
   fields for the inputs that varied between runs, typed as short text, long
   text, date, file, or dropdown. Steps that look automatable are marked as
   suggested AI steps.
4. **You approve. Then it ships.** Nothing is created anywhere until you
   approve a specific proposal. On approval, Repeatable creates the
   blueprint in your Tallyfy account through the Tallyfy MCP server. If the
   same process is detected again later, it proposes an update to the
   existing blueprint instead of creating a duplicate.

## Install

From this repo's marketplace:

```
/plugin marketplace add tallyfy/repeatable
/plugin install repeatable@tallyfy
```

Manual, for development:

```
git clone https://github.com/tallyfy/repeatable
claude --plugin-dir ./repeatable
```

Then run `/repeatable:setup` once. It checks prerequisites, walks you
through connecting the Tallyfy MCP server (mcp.tallyfy.com), offers to index
your existing session history, and writes your preferences.

**Prerequisites:**

- Claude Code, current release (the plugin is developed and tested
  against v2.1.218; older versions may lack plugin features it uses)
- Node.js 22.13 or newer on your PATH (Node 24 LTS recommended). The
  plugin's background pieces are plain Node scripts with zero npm
  dependencies; the local index uses Node's built-in `node:sqlite`. If Node
  is missing or too old, the plugin stays quiet and `/repeatable:setup`
  tells you exactly what to install.

## Quickstart

```
/plugin marketplace add tallyfy/repeatable
/plugin install repeatable@tallyfy
/repeatable:setup        # one-time: prerequisites, Tallyfy connection, thresholds
... work normally for a few days ...
/repeatable:status       # see what is indexed and which clusters are forming
/repeatable:review       # draft a detected process, approve, push to Tallyfy
/repeatable:import doc.md  # or draft from an SOP you already have
```

## How detection works (one paragraph)

Every Claude Code session already leaves a transcript on your machine under
`~/.claude/projects/`. When a session ends, a hook queues its path and exits
immediately; a detached background worker then extracts a small fingerprint
of the session: your prompts (with obvious secrets stripped), the sequence
of tool names used, and timing. Prompts are normalized (paths, URLs, ids,
and numbers become placeholder tokens) and hashed with MinHash so sessions
can be compared cheaply; tool sequences are compared by edit distance. When
enough similar sessions accumulate across enough days, the group becomes a
candidate process you can review. Tool results, file contents, and Claude's
replies are never indexed at all.

## Commands

| Command | What it does |
|---|---|
| `/repeatable:setup` | Guided setup: prerequisites, Tallyfy MCP connection, privacy summary, thresholds, optional history backfill |
| `/repeatable:review` | List detected candidate processes, draft the full procedure for one, and, on your approval, push it to Tallyfy |
| `/repeatable:import <file>` | Draft a procedure from a static SOP: Markdown, plain text, HTML, or Word (.docx) |
| `/repeatable:status` | What is indexed, which clusters are forming, what was pushed, and any parse warnings |

## Configuration

`/repeatable:setup` writes a local config file (JSON, hand-editable) in the
plugin's data directory. Everything is tunable:

- `min_sessions` (default 3) and `min_days` (default 2): how much
  repetition counts as a process.
- `similarity.prompt_jaccard` (default 0.5) and `similarity.tool_sequence`
  (default 0.6): how alike two sessions must be.
- `ignore_projects`: directories to never index.
- `tallyfy.tags`: tags applied to blueprints this plugin creates
  (default `["repeatable"]`).

## Platform support

- **macOS and Linux**: supported. The test suite runs on both.
- **Windows**: expected to work (everything is plain Node.js, hooks use the
  cross-platform exec form, and the worker detaches with standard Node
  primitives), but we have not validated it end to end on real Windows
  machines yet, and detached-process behavior on Windows has real quirks.
  We will not claim Windows support until it is tested. If you run Windows
  and want to help, see the issues labeled `help wanted`.

## FAQ

**Does my code or data leave my machine?**
Not from this plugin. Indexing is local and offline. The only outbound
write the plugin ever performs is creating or updating a blueprint in your
own Tallyfy account after you approve that specific proposal. Drafting
happens inside your normal Claude Code session, so it is covered by the
same terms as the rest of your Claude usage; the plugin adds no new
destination for your data.

**Do I need a Tallyfy account?**
Only for the push step. Without one you can still detect processes, review
drafts, and keep them as local files.

**Will it slow Claude Code down?**
No. The session-end hook writes one small file and exits immediately; the
real work happens in a detached low-priority worker after your session has
already ended.

**Why has nothing been detected yet?**
You need at least `min_sessions` similar sessions across `min_days` days.
Run `/repeatable:status` to see clusters forming, or lower the thresholds
in setup.

**How do I opt a project out?**
Add it to `ignore_projects` in the config. To keep a single session out of
everything (including Claude Code's own history), see Claude Code's
transcript controls (`CLAUDE_CODE_SKIP_PROMPT_HISTORY`).

**How do I uninstall?**
`/plugin uninstall repeatable`. Claude Code deletes the plugin's local data
directory (index, queue, config) as part of uninstall.

## How this fits with Tallyfy

Repeatable gets a process out of your head (or out of a stale document) and
into a form that actually runs: a [Tallyfy](https://tallyfy.com) blueprint
with steps and a kick-off form. From there, Tallyfy tracks every run, and
AI-run steps can execute through the same Tallyfy MCP server you connected
here. Repeatable is part of the same effort as
[Stern Stella](https://sternstella.com), which continuously improves the
processes you already run.

## Contributing

Development guide, architecture, and the privacy rules that bind all
contributions are in [CLAUDE.md](CLAUDE.md). Every change starts as an
issue; the founding spec issues describe the architecture area by area.

## License

MIT. See [LICENSE](LICENSE).
