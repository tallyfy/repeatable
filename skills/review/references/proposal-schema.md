# Proposal contract (proposal_version 1)

The single artifact that is drafted, reviewed, stored, and pushed. Keep
it strictly to this shape; the CLI and the push runbook depend on it.

```json
{
  "proposal_version": 1,
  "source": "detected",
  "fingerprint": "dd8a3a2758ed",
  "title": "Weekly release notes",
  "summary": "Draft, review, and publish the weekly release notes.",
  "kickoff_fields": [
    {
      "label": "Release version",
      "type": "short_text",
      "required": true,
      "options": [],
      "evidence": "version differed in every session (2.14.1, 2.15.0, 2.16.0)"
    },
    {
      "label": "Changelog file",
      "type": "file",
      "required": true,
      "options": [],
      "evidence": "a different changelog path was referenced each time"
    },
    {
      "label": "Channel",
      "type": "dropdown",
      "required": false,
      "options": ["stable", "beta"],
      "evidence": "only these two values ever appeared"
    }
  ],
  "steps": [
    {
      "position": 1,
      "title": "Draft the notes",
      "description": "Draft the release notes for {{Release version}} from {{Changelog file}}, summarizing the merged changes.",
      "executor_hint": "ai"
    },
    {
      "position": 2,
      "title": "Review and publish",
      "description": "Review the draft, then publish it to the {{Channel}} channel and tag the release.",
      "executor_hint": "human"
    }
  ]
}
```

## Field rules

- `proposal_version`: always `1`.
- `source`: `"detected"` (from a cluster) or `"import"` (from a static
  document).
- `fingerprint`: the cluster fingerprint (detected) or the
  `fingerprint-text` output for the imported document (import). 12 hex
  characters.
- `title`: short, imperative-noun phrase; no trailing punctuation.
- `summary`: one or two sentences. The push runbook appends a marker
  line to it; do not add one yourself.
- `kickoff_fields[].type`: one of `short_text`, `long_text`, `file`,
  `date`, `dropdown`. Nothing else.
- `kickoff_fields[].options`: non-empty ONLY for `dropdown` (2 to 8
  observed values, verbatim).
- `kickoff_fields[].evidence`: one plain-English line noting what varied
  across the evidence. Shown to the user; not pushed to Tallyfy.
- `steps[].position`: 1-based, contiguous, in execution order.
- `steps[].description`: an executable instruction. Reference kick-off
  fields by label in double braces, for example `{{Release version}}`.
- `steps[].executor_hint`: `"ai"` only when the step was tool-mechanical
  with no human judgment in the evidence; otherwise `"human"`. When
  unsure, `"human"`.

## Validation checklist (before saving)

- [ ] JSON parses; all required keys present; no extra top-level keys
- [ ] Every field label referenced in step descriptions exists in
      `kickoff_fields`
- [ ] Types only from the allowed set; options only on dropdown
- [ ] No tool output, file contents, or secrets anywhere in the text
