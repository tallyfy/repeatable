# Changelog

All notable changes to this plugin are documented here. The format follows
Keep a Changelog; versions follow SemVer. Users receive plugin updates only
when the `version` field in `.claude-plugin/plugin.json` changes.

## [Unreleased]

## [0.1.1] - 2026-09-28

- The bundled Tallyfy MCP server now uses `https://mcp.tallyfy.com/`, the
  same URL as Tallyfy's connector in the Claude directory, so people who
  have both see one set of tools. The old `/mcp` path still works.

## [0.1.0] - 2026-07-23

Initial public version.

- SessionEnd capture hook: queues finished sessions and exits immediately;
  a detached worker does all parsing off the session path.
- Defensive JSONL transcript parser (allowlist extraction, fail-loud past
  20 percent unparseable lines).
- Local SQLite index via Node's built-in node:sqlite (zero npm
  dependencies).
- Zero-LLM detection: MinHash over normalized prompts plus tool-sequence
  similarity; a cluster is 3 or more similar sessions across 2 or more
  days (configurable).
- /repeatable:setup, /repeatable:review, /repeatable:import,
  /repeatable:status commands.
- Push to Tallyfy via the user's own Tallyfy MCP connection, with
  fingerprint-based dedupe (later detections propose an update, not a
  duplicate).
- Privacy gates: ingest and outbound redaction, storage allowlist,
  no-network test.
