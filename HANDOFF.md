# Public engineering handoff

This public repository begins with a clean source snapshot. Private deployment history, personal commit metadata, account resource identifiers, local automation and original design/demo artifacts are intentionally excluded. No vendor keys, original documents, paid-call results or personal spending approvals are included.

## Implemented and verified

Generic browser extraction, deterministic rule table, vendor response validation, durable Workflows/D1/R2 records, cost arithmetic, manifest-based browser building, correction proposals and explicit failed-document retries are implemented. Estimates remain local until confirmation. Unit/integration tests, TypeScript checks, UI build and Wrangler dry-run passed before export; the export itself is checked separately before publication.

## Deployment

Read docs/browser-deployment.md. The root configuration uses placeholders for Cloudflare resource provisioning and a workers.dev hostname. The cloud deploy script runs the check gate, applies D1 migrations and deploys with a source commit identity. Keys are supplied through secure Cloudflare Secrets Store setup, never source code. Access needs browser setup. A fresh-account deployment acceptance test remains outstanding.

## Open implementation work

- Verify local vendor request tokenization and an honest pre-upload cost bound, including outline recovery. No approximate counter is silently substituted.
- Supply an owner-specific taxonomy and spending approval; generic intentionally starts unconfigured. The separate public validation corpus has provisional references only.
- Run authorized live validation and a human-corrected bake-off; no accuracy metrics are claimed yet.
- Complete fresh-account deploy-button, resource provisioning and Access acceptance tests.

Explicit null throughput limits are permitted. Unknown duration is displayed as unavailable; Batch quota uncertainty is disclosed. Hard context limits, output caps and all classification invariants remain enforced. Model calls default disabled.

## Binding design excerpts

## 4. Standing rules

Breaking one is a defect.

1. **Fail loudly. Never fix silently.** No substitute models, no aliases, no skipped stages, no unbounded retries, no guessed defaults, no partial run presented as complete. When something is not as expected: stop the affected work, say exactly what is wrong in plain language, record it.
2. **Code decides; models inform.** The outcome comes from §5.6 and nothing else.
3. **Record, never edit.** Model outputs and human corrections are stored as given. Nothing post-processes a model output or a human decision.
4. **Pin models by versioned ID.** If a response's `model` field differs from the pin, the run halts. A pin change is a dated note plus a re-run of the bake-off.
5. **No constant fitted to a specific document.** The threshold is set from corrections over a set of documents, recorded with the correction that set it, and applied only on explicit human action.
6. **No client or test-data strings in code, prompts or UI text.**
7. **Accuracy over speed.** Parallelism and batching that provably cannot change a result are unlimited. Anything that changes what a model sees or how a decision is made is not.
8. **Capability and accuracy win over cost, speed and simplicity — when the gain is demonstrated on the project's own documents.** Undemonstrated gains are preferences and are subject to "prefer deleting."
9. **Originals never leave the user's machine.** The cloud receives text and outline only.
10. **Nothing is applied automatically from a correction.** The system proposes; a person accepts.
11. **Written for a non-technical reader.** Every user-visible string. Technical detail lives behind a disclosure.


## 6. Failure policy

**Blocker** — run does not start or halts; nothing further is filed. **Per-document failure** — that document lands in `could_not_process/` with its reason; others continue. **Note** — recorded on the document; the document goes to `human_review/` via R0n.

**Blockers:** missing or rejected vendor key; pinned model not accepted, or `model` drift in any response; type file missing or invalid; storage binding missing or write probe failing; kill switch set; projected cost ceiling above budget without override (§6.4); N consecutive documents (default 3) exhausting retries against the same vendor.

**Per-document failures:** unsupported format; no text layer; digest outline over budget; full text over the reader's context (no chunking); confidence-check response failing validation; reader response failing validation after one retry; vendor unavailable after the step's retry policy (default 3 attempts, exponential backoff, `retry-after` honoured).

**Notes:** `N_NO_OUTLINE`, `N_NO_STRUCTURAL_SECTIONS`, `N_OUTLINE_RECOVERED` (outline came from §5.3 recovery), `N_EXTRACTOR_VERSION_MIXED` (run-level: documents read by more than one extractor version — flagged, not blocked).

**NEVER:** retry with a changed request; overwrite an artefact (each attempt is a new key); re-enqueue failed documents automatically (a person presses "retry failed", which is a new run with its own estimate); swallow an exception (every catch re-raises, converts to a typed failure with user text, or is commented as intentional).

**Every failure renders three ways from one typed object:** plain headline; what to do (with the exact sentence to send the technical contact, if needed); collapsed technical details (code, vendor, status, request id, run id).

### 6.4 Cost guards

- **Ceiling before upload.** From the local token counts: for every document, reader input tokens × 2 attempts + reader max output tokens × 2 attempts, plus confidence-check input tokens, at the pinned models' published prices. Shown as *worst case* beside an *expected* figure. If the worst case exceeds the project budget the run is refused — unless the user selects **Run anyway**, which removes the spending limit for that run entirely. The page states: "This run has no spending limit. Actual spend will be shown live and recorded, but nothing will stop the run on cost. The kill switch is the only way to halt it." The override and who chose it are recorded on the run.
- **Live spend** is summed from vendor usage fields and shown on the run page. With a budget in force, crossing it halts the run.
- **Kill switch.** One flag, checked first in every Workflow step; when set, steps throw `NonRetryableError` and every run halts within one step.
- **No automatic re-runs**, ever.


## 12. Decisions already made

| Decision | Instead of | Because |
|---|---|---|
| Two vendors on every document | One LLM; Jev as a gate | A confident-wrong gate goes unopposed; both on everything gives a 100% audit sample. |
| Choice + Nouls from Jev | Choice only | Same call, zero cost; Nouls are the only absolute per-type answer from the calibrated vendor, making cross-vendor agreement absolute-vs-absolute. |
| One reader call, per-type verdicts (default) | Five per-type calls | Same model either way; one call lets it compare confusable types. Tested in the bake-off; the more accurate wins. |
| Two outcomes, one threshold | A spot-check tier | It had no owner. The threshold moves on evidence from corrections. |
| Structure-derived digest | First page; whole document; LLM summary | Method lives under headings; an LLM summary puts a third judgement in front of the calibrated one. Structural-vocabulary-only selection cannot pre-bias toward a type. |
| Outline recovery by a cheap model, verbatim-verified | Accepting thin PDF outlines | Capability gain with an exact correctness check; it locates, it does not judge. |
| Local extraction in the browser, text-only upload | Upload binaries, parse in Workers or containers | Originals never leave the machine; upload shrinks from gigabytes to megabytes; no size caps, no document storage, no server parsing limits, no containers. |
| Chrome/Edge only, stated up front | Also Firefox/Safari with a CLI builder | One path; the File System Access API is required to build folders locally. |
| Manifest + local builder | Zip download; R2 sync | Nothing to transfer or store; the person already has the documents. |
| Corrections as folder moves | A number; a form | A number loses context; a form is cumbersome; moving files is what the person does anyway. |
| Tag-first matching, fingerprint fallback | Hashing everything | Zero-cost matching for any tree size; hashing only for renamed files. |
| Threshold in D1 with justification | Repo config | One number should not need a deploy; justification gives the same auditability. |
| Text deleted on run closure | Keep; or delete on a timer | Compliance; and a timer is a silent action. |
| Improvement loop as proposals only | Automatic prompt updates; nothing | Captures the accuracy gain without the system changing itself. |
| Workflows per document, polling for progress | Queues; Durable Objects + WebSockets | Checkpointing and retry policy are the failure policy; polling suffices. |
| Cost ceiling from known tokens, full override available | Estimate; hard cap only | Local extraction makes the ceiling exact; the owner may choose no limit, explicitly and recorded. |
| Published vendor and platform limits only | Assuming enterprise limits | They do not exist for this account. |

**Deliberately left out — do not add without evidence:** OCR; containers; Durable Objects; retention timers; drift dashboards; language detection; a separate eval harness or labelled-set precondition; autoscaling; multi-tenancy; a CLI builder; automatic application of any correction.


### 5.6 Decide

Let `choice`, `certainty`, `noul[t]` come from the confidence check and `yes` = types the reader marked `is_type: true`.
`agree(t)` := `choice == t` AND `noul[t] ≥ 0.5` AND `yes == {t}`.

| # | Condition | Outcome | Folder |
|---|---|---|---|
| R0 | any stage failed | could_not_process — reason | `could_not_process/` |
| R0n | any note on the document | review — the note | `human_review/` |
| R1 | `agree(t)` AND `certainty ≥ threshold` | **filed** as `t` | `<t>/` |
| R2 | `agree(t)` AND `certainty < threshold` | review — low certainty | `human_review/` |
| R3 | `yes` has ≥ 2 types | review — straddles types | `human_review/` |
| R4 | `yes` empty AND `choice == none_of_these` AND all `noul[t] < 0.5` | review — possible new type | `human_review/` |
| R5 | anything else | review — the two systems disagree; **priority 1** | `human_review/` |

First match wins. The rule id is recorded. 0.5 on the Noul is the probability midpoint, not a tuned constant.


## Public snapshot verification

The exact sanitized export passed a clean npm ci, 164 tests, browser/Worker TypeScript checks, production UI build and Wrangler dry-run. Placeholder resources only; no deployment or vendor call was performed by these checks. A recursive pre-publication scan found no known private account identifiers, personal paths/email, original private commit/deployment identifiers or credential-shaped tokens in the exported source. Independent privacy review is also required before visibility changes.

## Monitored run budgets (2026-09-22)

Replaced required upfront cost prediction with per-run combined/OpenAI/TypeSafe limits or explicitly acknowledged unlimited spending. Records actor/time and actual API usage with exact integer arithmetic; stops new calls at any reached limit while accounting for submitted work. Unknown charges remain visible. Local digest policy and classification requests are unchanged; the official Jev tokenizer is still required. Budget and reader billing-tokenizer fields are no longer readiness gates. Batch accounting is restricted to known submitted jobs and GET-only retrieval; successful closure reconciles terminal jobs before removing uploaded text. No migration or model activation is required.

Private implementation passed 181 tests, both TypeScript checks, production UI build and browser budget consent checks. Public export receives its own release verification. No live model validation or accuracy result is claimed.

Public release copy review: the original snapshot's open item for exact request tokenization and a pre-upload cost bound is superseded by monitored per-run spending. The remaining tokenizer task is solely the official Jev implementation for the unchanged 6,000-token digest. New runs record their own budget decision; a mandatory project-pack budget is no longer a readiness requirement. Historical design excerpts above are read together with the latest DESIGN amendment.

Generic starter correction: Batch enqueued-token allowance is explicitly null (unknown), matching the validator's optional throughput contract. Missing account throughput does not block classification setup. No model or extraction setting changed.
