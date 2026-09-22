# AGENTS.md

Instructions for any coding agent or harness working in this repository. Read `DESIGN.md` first — it is the single source of truth. This file tells you what you may change, what you may never change, and how to work.

## What this system is

A generic two-system document classifier. Documents are extracted on the user's machine in the browser; only text and outline are uploaded. A calibrated classifier (TypeSafe Jev) and a reader (OpenAI GPT-5.6 Terra) each judge every document; deterministic rules file a document only when both agree at or above a certainty threshold; everything else goes to a person. The run's deliverable is a manifest; a local builder turns it into a folder tree using the user's originals; the person's corrections come back as folder moves. Nothing fails quietly, and nothing is applied automatically from a correction.

## Layout

```
core/            everything domain-agnostic — do not adapt per project
projects/<name>/ one project pack per project — this is where project work happens
ui/reference/    visual design reference for the UI (not an architecture reference)
DESIGN.md        the plan; §4 (standing rules), §5.6 (decision), §6 (failure policy), §12 (decisions) are binding
HANDOFF.md       what previous engineers/agents learned; append, never rewrite history
```

Within `core/`, file layout, framework choice, schemas and naming are yours. Record non-obvious choices in `HANDOFF.md` with the alternative you rejected and why.

## The routine change: adapting a project

1. Create or edit `projects/<name>/`:
   - the **type file** — every type with `id` (snake_case, unique), `name`, `what`, `not_for`, one or more `examples`; plus `none_of_these`;
   - the **structural vocabulary** — words naming *parts* of a document, never *types*; the loader rejects collisions and you may not weaken that check;
   - **settings** — digest token budget; reader effort; Batch/interactive default and its document-count cutoff; product name and copy overrides;
   - **pins** — versioned model IDs only, each with date and reason;
   - **budget** — the per-run spending limit. Change only with the owner's written sign-off recorded in `HANDOFF.md`.
2. Deploy: `wrangler deploy --env <name>`. Confirm `/health` reads READY.
3. Run the first batch with the initial threshold (0.90). Its corrected tree is the project's dataset. Run the bake-off variants in `DESIGN.md` §10 against it and record the numbers in `projects/<name>/README.md`.

If a project needs behaviour the pack cannot express, stop and write it up under "Open issues" in `HANDOFF.md`. Do not add project-specific branches to `core/`.

## Never

From `DESIGN.md` §4, §6 and §12. Each is a defect, not a preference.

- Add a fallback model, use a model alias, retry with a changed request, invent a default that hides a missing value, or present a partial run as complete.
- Let a model decide the final label. Outcomes come from the rule table in `DESIGN.md` §5.6 only.
- Post-process or "correct" a model output or a human correction.
- Combine Jev Choice probabilities with Noul values arithmetically.
- Tune a constant, threshold, prompt or example to fix one observed document.
- Put client names, document titles or test-document strings in code, prompts or UI text.
- Add type vocabulary to the structural vocabulary, or weaken the collision check.
- Upload, store, or read a user's original document in the cloud. Text and outline only.
- Accept a recovered outline heading that does not exist verbatim in the extracted text.
- Change results in pursuit of throughput: no chunking, no smaller digests, no skipping the reader. Parallelism and Batch are fine; anything that alters an answer is not.
- Overwrite an artefact, delete run text other than on run closure by the user, or delete anything on a timer.
- Re-run failed documents automatically, add autoscaling, or bypass the kill switch.
- Apply any threshold change, example, `not_for` sentence or new type automatically from a correction. Propose; a person accepts.
- Use Workflow instance state as the system of record.
- Support browsers other than Chrome and Edge for the local steps, or add a CLI builder.
- Assume enterprise or negotiated limits from any vendor or platform.
- Touch the Cloudflare Access configuration.

## How to work

- **Fail loudly in your own work.** If a dependency, binding, secret, limit or vendor is not as you expect in your environment, say so and stop. Do not stub it and continue.
- **Verify platform and vendor facts against current documentation** before relying on them, and record what you verified and when in `HANDOFF.md`. `DESIGN.md` §11 lists the limits verified at design time; they can change.
- **Tests first** for the decision rules, vendor validators, digest builder, outline recovery verification, cost ceiling arithmetic, correction diff, and builder. One command, one printed total; deploy is gated on it.
- **UI**: build to `ui/reference/`. Plain language; measured timings only; fixed outcome colours; light and dark; reduced-motion disables transitions only; every user-visible string in one place; never the word "fast"; "filed" is used only for R1.
- **Vendors**: persist every raw response before parsing; validate the returned `model` against the pin and halt on mismatch; honour `retry-after`; set a maximum output token cap on every reader call.
- **Ask, don't assume,** when `DESIGN.md` is silent on anything that changes a classification result. When it is silent on something that does not, decide and record.

## Before you call anything done

- [ ] All tests pass; the total is printed.
- [ ] `/health` reads READY on the deployed environment.
- [ ] Bake-off re-run if a pin, prompt, digest budget or reader configuration changed; numbers recorded.
- [ ] No new string in code, prompt or UI contains client or test-document content.
- [ ] `HANDOFF.md` updated: what changed, what you verified, what you learned, what is open.
