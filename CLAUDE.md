# CLAUDE.md - developer guide for tallyfy/repeatable

Open-source Claude Code plugin: detects repeatable processes in local
Claude Code session logs and, after explicit user approval, creates them as
Tallyfy blueprints via the Tallyfy MCP server. Public repo. MIT license.

User-facing docs live in README.md; the privacy contract lives in
PRIVACY.md. This file is for people (and AI sessions) changing the code.

## Architecture map

```
.claude-plugin/plugin.json       manifest (name "repeatable", explicit semver)
.claude-plugin/marketplace.json  this repo is also the "tallyfy" marketplace (source "./")
skills/
  setup/SKILL.md                 /repeatable:setup  - guided config + MCP connect + backfill
  review/SKILL.md                /repeatable:review - clusters -> draft -> approve -> push
  import/SKILL.md                /repeatable:import - static SOP -> draft -> approve -> push
  status/SKILL.md                /repeatable:status - index stats, clusters, warnings
  review/references/             drafting-prompt.md, proposal-schema.md, push-runbook.md
hooks/hooks.json                 SessionEnd -> exec-form "node scripts/enqueue.js"
scripts/enqueue.js               stdlib-only; queue entry + detached worker spawn; exits 0 fast
worker/                          stdlib + node:sqlite only (no npm deps)
  worker.js                      singleton lock, drain queue, index, cluster; --deep mode
  parser.js                      defensive version-pinned JSONL parser (fail loud, never crash)
  indexer.js                     allowlist extraction -> sessions row
  normalize.js minhash.js toolseq.js cluster.js
  db.js                          node:sqlite schema v1
  redact.js                      secret patterns (ingest gate + outbound gate)
  paths.js                       data dir / projects root resolution
  cli.js                         JSON commands the skills call
.mcp.json                        Tallyfy remote MCP server (type http)
test/                            node:test + synthetic fixtures; zero test-framework deps
```

Data flow: SessionEnd -> queue file -> detached worker -> SQLite index
(`repeatable.db` in the plugin data dir) -> clusters -> `/repeatable:review`
(drafting happens in the user's own session) -> user approval -> Tallyfy MCP
push -> local pushed-blueprint map (plus a fingerprint marker line stored in
the blueprint summary for recovery).

## Privacy rules (hard constraints; PRs violating these are rejected)

1. `scripts/` and `worker/` make ZERO network calls. No fetch, no dns, no
   http(s), no telemetry, no version pings. Enforced by
   `test/no-network.test.js`.
2. The index NEVER stores tool results, file contents, assistant messages,
   or images. Only: user prompts (redacted), tool names, one-way argument
   digests, timestamps, and metadata. See the allowlist in
   `worker/indexer.js` and the DB-content test.
3. Nothing is written to Tallyfy except an approved proposal, and only from
   the review/import skills. The worker has no MCP access.
4. `worker/redact.js` runs on ingest AND again on the outbound proposal
   (JWT-like `eyJ` tokens, common key prefixes, high-entropy strings). Both
   gates have tests.
5. Zero runtime npm dependencies is a feature, not an accident. Every new
   dependency is a supply-chain surface inside users' machines and needs
   maintainer sign-off with a written justification. Prefer stdlib.
6. Session JSONL is Claude Code internal format and can change on any
   release (stated in the official sessions doc). `worker/parser.js` pins
   known-good shapes, counts skipped lines, marks a session `parse_failed`
   above 20 percent skipped, and never throws to the caller.
7. Test fixtures are SYNTHETIC. Never commit real session logs, real
   transcripts, real machine paths (beyond generic examples), or anything
   containing tokens. Run a secret scan before every push.

## Why node:sqlite (and not better-sqlite3)

The local index uses Node's built-in `node:sqlite` (`DatabaseSync`).
Rationale, decided July 2026:

- Available without flags since Node 22.13.0 / 23.4.0, present in Node 24
  LTS. Node 20 is end-of-life (April 2026), so requiring Node >= 22.13 is
  a reasonable floor.
- Zero npm dependencies: no install step, no native builds, no node-gyp
  failures on toolchain-less machines, no postinstall scripts, and a much
  smaller supply-chain surface for a plugin whose whole story is privacy.
- The API is still marked experimental (release-candidate stability) in
  Node docs. We accept that: the surface we use (DatabaseSync, prepare,
  exec, run/get/all) is the stable core, `worker/db.js` is the only module
  that touches it, and if the API ever breaks we swap db.js for
  better-sqlite3 behind the same interface. The ExperimentalWarning on
  stderr is suppressed in our entrypoints and by invoking node with
  `--no-warnings` from skills.
- better-sqlite3 remains the documented fallback; nothing else in the
  architecture would change.

## Cross-platform rules

- Hooks use EXEC FORM (`"command": "node", "args": [...]`), which spawns
  without a shell and behaves identically on macOS, Linux, and Windows
  (documented in the Claude Code hooks reference; Windows cannot spawn
  `.cmd` shims, so `node` + script path is the paved road).
- Detachment: `child_process.spawn(process.execPath, [worker], {detached:
  true, stdio: "ignore", windowsHide: true}).unref()`. Never nohup/disown
  (POSIX-only). This sidesteps the known SessionEnd behavior where Claude
  Code exits without waiting for hook async work
  (anthropics/claude-code#41577): the hook writes a queue entry and exits 0
  immediately; the detached worker does the real work.
- Paths: always `path.join`; home via `os.homedir()`; honor
  `CLAUDE_CONFIG_DIR` when locating `~/.claude/projects`.
- The worker lowers its own priority (`os.setPriority`, best-effort).
- Windows is expected-working but NOT yet validated end to end; do not
  claim tested-on-Windows anywhere until CI and a manual smoke confirm it.

## Build and test

```
node --test                     # unit + fixture tests, zero dependencies
claude plugin validate . --strict
claude --plugin-dir .           # manual smoke: /repeatable:status
```

Known validator advisory: validating the plugin WITHOUT the marketplace
manifest warns that a root CLAUDE.md is not loaded as project context
for plugin users. Deliberate: this file is the contributor guide for
people working in the repo, not runtime context for plugin users (the
skills carry all runtime instructions). Repo-root validation, which is
what CI runs, passes --strict.

There is no build step. There are no dependencies to install.

CI (GitHub Actions): ubuntu + macos + windows, Node 22 and 24, `node
--test`. Windows CI runs the suite but is not yet a support claim (see
Cross-platform rules).

## Release process

1. Bump `version` in `.claude-plugin/plugin.json` (semver). Users only
   receive updates when this field changes, because we set it explicitly.
2. Update CHANGELOG.md. Tag `vX.Y.Z`. Create a GitHub release.
3. The self-hosted marketplace is this repo, so pushing to `main` publishes
   the update; users refresh with `/plugin marketplace update`.
4. Never rename the plugin `name` field: installs key off it.
   `displayName` is the safe cosmetic field.
5. Community marketplace submission (once ready) goes through Anthropic's
   plugin submission form; run `claude plugin validate . --strict` first.

## Style rules

- ASCII only, in every file and every commit message. No em-dashes, no
  smart quotes, no emojis. This keeps diffs, terminals, and JSON parsing
  boring and predictable.
- Outward-facing wording: this is a public repo. No hype, no competitor
  bashing, no internal Tallyfy details, no pricing.
- Small commits, each one buildable and testable.
- Spec-first: every change starts as a GitHub issue in this repo; the issue
  body is the single authoritative spec and is updated in place when scope
  moves. The founding spec issues describe the architecture area by area.

## Secret scan before every push

```
grep -rn "eyJ" --exclude-dir=.git --exclude-dir=node_modules . | grep -v REDACTED
node -e "const {execSync}=require('child_process');const fs=require('fs');const path=require('path');function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(f==='.git'||f==='node_modules')continue;const s=fs.statSync(p);if(s.isDirectory())walk(p);else{const t=fs.readFileSync(p,'utf8');const m=t.match(/[A-Za-z0-9+\/=_-]{40,}/g)||[];for(const x of m){const e=[...new Set(x)].length;if(e>20)console.log(p,x.slice(0,12)+'...')}}}}walk('.')"
```

Review anything either command prints before pushing. Fixture files must
contain only obviously fake placeholder values.
