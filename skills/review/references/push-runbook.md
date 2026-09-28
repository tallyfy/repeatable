# Push runbook: approved proposal -> Tallyfy blueprint

Executed ONLY after explicit user approval of a rendered draft. Uses the
user's own authenticated Tallyfy MCP connection (server `tallyfy`,
https://mcp.tallyfy.com/). All calls are sequential single-item
operations; the Tallyfy MCP server intentionally rejects bulk mutations.

Tool names below match the Tallyfy MCP server's template/field surface.
If a named tool is missing from the connected server (surfaces evolve),
find the equivalent in the current tool list before improvising. As a
last resort the server has generic `tallyfy_api_read` and `tallyfy_api_write`
fallback tools, but they refuse unless the deployment has enabled them, so do
not count on them.

## Field type mapping

| Proposal type | Tallyfy field_type |
|---|---|
| short_text | text |
| long_text | textarea |
| date | date |
| file | file |
| dropdown | dropdown (options as a list of objects: text, optional id) |

`field_data` for every kick-off field MUST carry `field_type`, `label`,
and `required` (boolean; there is no default).

## Step 0: dedupe preflight (never create duplicates)

1. Local map: the cluster row may already carry a `blueprint_id`
   (from the `cluster --fingerprint` output). If present -> UPDATE path.
2. Remote recovery (covers reinstalls and second machines): call
   `search_for_templates` with the marker string
   `repeatable-fingerprint: <fp>`. If a template's summary contains the
   marker -> record its id and use the UPDATE path.
3. Otherwise -> CREATE path.

## CREATE path

1. `create_template` with the proposal title and summary, where the
   summary gets one extra final line, exactly:
   `repeatable-fingerprint: <fp>`
2. For each step in `steps` order: `add_step_to_template` with the step
   title; then `edit_description_on_step` with the full description if
   creation could not carry it. For steps with `executor_hint: "ai"`,
   prefix the description's first line with `[Suggested AI step] `.
3. For each kick-off field in order: `add_kickoff_field` with the
   mapped `field_data`. If creation order was not preserved, fix it with
   `reorder_kickoff_fields`.
4. `tag_template` with the configured tags (config `tallyfy.tags`,
   default `repeatable`).
5. Read back with `get_template`. Verify: step count, step order, field
   labels and types, options, the marker line. Fix discrepancies with
   the matching update tool before proceeding.
6. Compute the checksum: sha256 over the read-back title, then each step
   title and description in order, then each field label and type in
   order, joined with newlines; take the full hex. (Run it locally, for
   example with `node -e` and `crypto`.)
7. Bookkeeping:
   ```
   node --no-warnings "${CLAUDE_PLUGIN_ROOT}/worker/cli.js" mark --fingerprint <fp> --status pushed --blueprint-id <id> --checksum <sha256>
   ```
8. Show the user the blueprint link from the tool response.

If the push fails midway: the proposal and cluster state are still
local; verify what exists with `get_template` and continue from the
first missing element (idempotent resume). Never restart with a second
`create_template`.

## UPDATE path (fingerprint already has a blueprint)

1. Drift guard: `get_template`, recompute the checksum (step 6 above),
   and compare with the stored `last_pushed_checksum` from the cluster
   row. If they differ, someone edited the blueprint in Tallyfy since
   the last push. STOP and show a three-way notice: last pushed / what
   is in Tallyfy now / the new proposal. Only continue with explicit
   confirmation.
2. Diff the new proposal against the blueprint read-back:
   - changed step description -> `edit_description_on_step`
   - new step -> `add_step_to_template` (+ order fix)
   - new kick-off field -> `add_kickoff_field`
   - changed kick-off field -> `update_kickoff_field`
   - changed title or summary -> `update_template`, PRESERVING the
     `repeatable-fingerprint: <fp>` marker line
3. NEVER delete steps or fields automatically. Anything present in
   Tallyfy but absent from the proposal is listed to the user, each
   removal individually confirmed; the default is keep.
4. Read back, recompute checksum, and run the same `mark ... --status
   pushed` bookkeeping with the new checksum.

## Privacy reminder

The only content sent in this runbook is the approved proposal text and
tags. If at any point you would be sending transcript content, tool
output, or file contents: stop, that is a bug (see PRIVACY.md).
