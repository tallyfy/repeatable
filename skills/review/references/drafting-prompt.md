# Drafting instructions (the deliberate AI step)

Detection was arithmetic; this is the one place judgment is applied. You
are drafting a procedure a stranger could run: complete, ordered, with
the variable inputs surfaced as form fields. The draft must be
approvable in one read.

## Inputs you have

- The cluster's member sessions: for each, the ordered user prompts
  (redacted) and the ordered tool-name sequence.
- Optionally, the original transcripts still on disk: use ONLY user-role
  prompt text and tool names from them. Never read tool results,
  file contents, or assistant replies into the draft.

## Method

1. **Align the sessions.** The members are runs of the same process.
   Line up their prompts in order; most positions will correspond.

2. **Derive steps.** One step per coherent goal, not per tool call.
   Merge micro-prompts that always occur together into one step.
   Preserve the observed order. A good step description is the
   generalized form of the prompt that was actually used: keep the
   user's verbs and vocabulary, drop the one-off specifics.

3. **Mine the variation into kick-off fields.** Wherever aligned prompts
   differ (a version number, a file, a customer name, a date, a target),
   that difference is an input. Create one kick-off field per distinct
   input, with a label a non-programmer understands. Type it by these
   rules, in order:
   - parses as a calendar date -> `date`
   - names a file or attachment to provide -> `file`
   - a small closed set of observed values (2 to 8 distinct) ->
     `dropdown` with exactly the observed options
   - a single line of 100 characters or fewer -> `short_text`
   - anything longer or multi-line -> `long_text`

4. **Rewrite step descriptions against the fields.** Replace the one-off
   specifics with `{{Field label}}` references so each description reads
   as an executable instruction with fillable inputs. Every referenced
   label must exist as a field.

5. **Mark executor hints.** `ai` only where the evidence shows a
   tool-mechanical step (the tools ran straight through, no mid-step
   human correction, in every session). Judgment, approval, or
   off-machine action means `human`. Unsure means `human`.

6. **Title and summary.** Title: what a teammate would call this process
   (3 to 6 words). Summary: one or two sentences on what running it
   achieves. No marketing language.

## Quality bar

- Steps cover ALL the observed work; nothing that happened in the
  sessions is silently dropped.
- No invented steps: if it is not in the evidence, it is not in the
  draft.
- Field labels are unique and human, not variable names.
- The text contains no secrets, no tool output, and nothing you would
  not want pushed to a workplace tool. The redaction gate will check,
  but write clean in the first place.
