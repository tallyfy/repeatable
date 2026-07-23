---
name: import
description: Draft a Tallyfy procedure from an existing SOP document (Markdown, plain text, HTML, or Word .docx, including wiki exports) and on explicit user approval push it to Tallyfy. Use when the user points Repeatable at an existing SOP, checklist, runbook, or process document to import.
---

# Repeatable import

Same contract and same approval gate as `/repeatable:review`, but the
evidence is a document the user already has instead of detected
sessions.

## Step 1: read the document

The user provides a file path. Accepted: `.md`, `.txt`, `.html`,
`.docx`.

- `.md` / `.txt` / `.html`: Read directly.
- `.docx`: it is a zip; extract the main document XML without any
  dependency, for example:

  ```
  node -e "const{execSync}=require('child_process')" 2>/dev/null || true
  unzip -p <file.docx> word/document.xml > <data_dir>/import-tmp.xml
  ```

  Then Read that XML and work from its text content (the `w:t` runs, in
  order). On Windows without `unzip`, ask the user to export the
  document as Markdown, plain text, or HTML instead; do not guess at
  binary parsing.

If the document is something else (PDF, image), ask for one of the
accepted formats; Claude Code may also be able to Read a PDF directly,
in which case proceed with its text.

## Step 2: fingerprint

```
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" fingerprint-text --file <the document>
```

Use the returned 12-hex value as the proposal fingerprint. Re-importing
the same document later produces the same fingerprint, so the push
dedupes into an update instead of a duplicate blueprint.

## Step 3: draft

Follow `${CLAUDE_PLUGIN_ROOT}/skills/review/references/drafting-prompt.md`
adapted to document evidence:

- Headings and numbered/bulleted list items become steps, in document
  order.
- "Fill in", "provide", "attach", "enter", "choose" language becomes
  kick-off fields, typed by the same rules (date / file / dropdown /
  short_text / long_text).
- `executor_hint` defaults to `human`; use `ai` only for steps the
  document itself describes as automatic or mechanical.

Produce proposal JSON per
`${CLAUDE_PLUGIN_ROOT}/skills/review/references/proposal-schema.md`
with `source` set to `import`.

## Step 4: gate, save, review, push

Exactly as `/repeatable:review` steps 4 to 7:

1. Save the draft to `<data_dir>/proposals/<fp>.draft.json`, then
   `save-proposal --fingerprint <fp> --file <path> --source import`
   (exit 3 = secrets found: show findings, fix, retry).
2. Render the compact review; ask approve / edit / dismiss.
3. On approve, follow
   `${CLAUDE_PLUGIN_ROOT}/skills/review/references/push-runbook.md`
   (dedupe preflight included), then `mark --status pushed` bookkeeping.

The `mark` command creates a minimal local record for import
fingerprints automatically, so dedupe works for imports exactly like
detected clusters. Mention the created blueprint link and that
re-importing this document proposes an update.
