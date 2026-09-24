# Document Classification System — Design

**For:** the coding agent building this and the engineer reviewing it.
**Runs on:** Cloudflare Workers Paid plan and generally available limits. No enterprise features or negotiated limits are assumed anywhere.
**In one sentence:** two unrelated AI systems classify documents into a project's taxonomy; code files a document only when both agree with high certainty; everything else goes to a person; the person's corrections come back as folder moves; nothing fails quietly.

This document is the single source of truth. It states what the system does, the decisions already made and why, and the rules that are binding. It does not prescribe file layout, frameworks, schemas, component structure or copy — those are yours. Where this document is silent on something that does not change a classification result, decide and record the decision in `HANDOFF.md`. Where it is silent on something that *does* change a result, stop and ask.

Terms defined in §1 are used exactly as defined throughout. "MUST" and "NEVER" are binding.

---

## 1. Terms

| Term | Meaning |
|---|---|
| **Project** | One taxonomy applied to one document set, deployed once. The first project is classifying past research reports by type. The core knows nothing about research reports. |
| **Core** | Everything not in a project pack. Domain-agnostic. |
| **Project pack** | The configuration that makes the core specific to a project (§3). |
| **Type** | One label in the project's taxonomy, defined in the type file. |
| **Type file** | The single file in the project pack listing all types with `id`, `name`, `what`, `not_for`, `examples`, plus the `none_of_these` option. Hashed on load; the hash is the **type version**. |
| **Confidence check** | The calibrated classifier role. Shipped adapter: TypeSafe Jev. Returns a Choice over all types plus `none_of_these` (with a probability per option and a certainty score) and one Noul (an absolute 0–1 yes/no) per type. |
| **Reader** | The deep-reading role. Shipped adapter: OpenAI GPT-5.6 Terra. Returns, for every type, `is_type` (boolean), a short rationale, up to three verbatim evidence quotes, and `closest_alternative`. |
| **Certainty** | The `confidence` value returned by the confidence check's Choice. |
| **Threshold** | The certainty at or above which an agreed classification is filed automatically. One number per project, stored in D1 with the correction that justified it. Initial value 0.90 until a correction has been processed. |
| **Digest** | The structured, budgeted extract the confidence check receives (§5.3). |
| **Fingerprint** | Content-derived identity of a document, computed on the user's machine at extraction time. Full SHA-256 by default. |
| **Tag** | A short run-scoped identifier (e.g. `r7-0042`) prefixed to each filename in the built tree so files can be matched by name after moving. |
| **Manifest** | The JSON a finished run produces: one entry per document with fingerprint, original filename, tag, destination folder, rule fired, reasoning note, and per-vendor outputs. The run's deliverable. |
| **Built tree** | The folder structure the local builder produces from the manifest and the user's originals (§7). |
| **Reserved folders** | `human_review/`, `could_not_process/`. Every other folder in a built tree is a type folder or user-created. |
| **Correction** | A built tree after a person has moved files, handed back as a listing (§8). |
| **Run** | One submission of documents through the pipeline. Has a type version, a threshold, a mode, a budget decision, and a state. |
| **Blocker / per-document failure / note** | The three failure classes (§6). |

## 2. The problem and the approach

Documents need a type label before they are findable. A single LLM labelling them always answers and cannot reliably say how sure it is; a confidently wrong label looks like a right one, so misfiles are invisible and permanent. **A misfiled document is worse than an unfiled one.**

```
  user's machine (Chrome/Edge)                      Cloudflare                        vendors
  ┌──────────────────────────┐    text+outline    ┌──────────────────────┐   digest   ┌──────────┐
  │ pick folder → extract    │ ─────────────────► │ Workflow per doc:    │ ─────────► │ Jev      │
  │ locally → fingerprint    │                    │  digest → check →    │ ◄───────── │          │
  │ → upload text only       │                    │  reader → decide     │  full text │ Terra    │
  └──────────────────────────┘                    │                      │ ─────────► │          │
              ▲                                   └──────────┬───────────┘ ◄───────── └──────────┘
              │ manifest (JSON)                              │
  ┌───────────┴──────────────┐                               │
  │ local builder: originals │ ◄─────────────────────────────┘
  │ + manifest → built tree  │
  │ (type folders, review,   │      corrected tree listing
  │  could_not_process)      │ ─────────────────────────────► diff → sentences → suggestions
  └──────────────────────────┘
```

The original documents never leave the user's machine. The cloud receives extracted text and outline, returns a manifest, and retains only decisions, vendor outputs and fingerprints after the run is closed.

## 3. Core and project pack

**Core** — local extractor and digest builder (runs in the browser), vendor adapters, decision rules, Workflow, storage, UI, local builder, correction analysis. Changed only for defects and platform changes.

**Project pack** — the type file; the structural vocabulary (§5.3); the digest token budget; the pins (versioned model IDs with dates and reasons); the per-run budget; the reader effort level; the Batch/interactive default and its document-count cutoff; product name and copy overrides. One deployment per project. No multi-tenancy inside a deployment.

`AGENTS.md` at the repository root states what a harness may change (the pack), what it may never change (§4, §6, §12), and the procedure for a project change.

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

## 5. Pipeline

### 5.1 Local extraction (browser)

- Runs only in Chrome or Edge. The Home page states this before anything else, with the reason: building folders on the user's machine without uploading documents requires the File System Access API, which Firefox and Safari do not provide. Other browsers are blocked at that point.
- The user picks a source folder. For each file: compute the fingerprint; extract full text with page/slide markers and an **outline** — headings with level and position, tables with column headers, text blocks with position; record the extractor version and parser library versions.
- Formats: PPTX and DOCX read as zip archives of XML (slide title placeholders and paragraph heading styles are the outline; tables are explicit). PDF via pdf.js (text items with font size and position; the PDF's own bookmarks when present; otherwise the heading heuristic in §5.3). Any other format → `could_not_process`, reason "unsupported file type". PDF with no text layer → `could_not_process`, reason "scanned document, no text layer". No OCR.
- Only the XML entries needed are read from PPTX/DOCX; images are skipped.
- Work is parallelised across Web Workers. State per document (`not started` / `extracted` / `uploaded` / `could_not_process` with reason) is kept locally so a closed browser resumes exactly, skipping uploaded documents. Upload is idempotent on (run, fingerprint).
- **Before upload**, the page shows the run's projected cost ceiling (§6.4) and the projected duration at published vendor limits, and asks the user to choose the run mode (§5.7). Nothing is sent until the user confirms.
- What is uploaded per document: fingerprint, original filename, full text, outline, extractor/parser versions, token counts. Never the file.

### 5.2 Cloud pipeline

One Workflow instance per document: digest → confidence check → reader → decide. Each step's result is checkpointed; steps retry per policy; terminal failures throw `NonRetryableError`. Workflow instance state is NEVER the system of record — every fact the UI shows is readable from D1/R2 after the instance expires. Step return values MUST stay small (≤ 1 MiB platform limit); large artefacts go to R2 with a key returned.

### 5.3 Digest

Built deterministically from the outline, within the project's token budget (default 6,000):

1. Title (document metadata, else first heading, else first text block).
2. Every heading, all levels, in order. NEVER trimmed.
3. Every table's column headers, in order. NEVER trimmed.
4. Text under headings, in this order until the budget is spent: headings matching the **structural vocabulary** in document order, then the remaining headings in document order.
5. A selection log: every heading included, every trim and its length.

Rules:
- The structural vocabulary names *parts of a document* (objectives, background, methodology, approach, design, sample, executive summary, findings, recommendations, appendix). It MUST NOT contain type vocabulary. The loader MUST reject any vocabulary term that appears as a token in any type's `name`, `what` or `examples`.
- If items 1–3 alone exceed the budget → `could_not_process`, reason "too large for the confidence check". Never cut the outline.
- **PDF heading heuristic**: body font size = the most common size in the document; a text item is a heading candidate if its size is markedly larger than body or it is bold, it is short, and it sits near the top of a page or after a larger vertical gap than typical. Section breaks are inferred from spacing, not fixed rules.
- **Outline recovery** (used only when the heuristic yields a thin outline — fewer headings than a project-configured minimum): a cheap model (Luna) is given the text and asked to list the lines that are section headings. Every returned line MUST exist verbatim in the extracted text; anything else is discarded. The recovered outline is marked as such in the manifest. This is the only model step outside the two vendor roles, and it judges nothing — it locates.
- No headings at all → digest is title + first text blocks to budget, and the document carries note `N_NO_OUTLINE`. No structural heading matched → sections in document order, note `N_NO_STRUCTURAL_SECTIONS`. Nothing widens silently.

### 5.4 Confidence check (Jev)

One request per document to `POST /v1/systemone`, model pinned (currently `jev-1.13.0`). State = the digest as named fields; instructions reference those fields by name. One Choice over all types plus `none_of_these`, one Noul per type, same request. Persist the raw response to R2 BEFORE parsing. Validate: `choice` is an option; probabilities cover exactly the options, each in [0,1], summing to 1 ± 0.02; `confidence` in [0,1]; each Noul in [0,1]; `model` equals the pin else blocker `E_JEV_PIN_DRIFT`. Choice probabilities and Noul values are NEVER combined arithmetically.

### 5.5 Reader (Terra)

One request per document via the Responses API, model pinned to the dated snapshot (resolve from the model page at implementation; NEVER the bare alias). `reasoning.effort` from the pack (initial `low`). Prompt order: task and output schema, then all type definitions from the type file, then the full text. Strict structured output: exactly one verdict per type with `is_type`, `rationale`, `evidence` (≤ 3 verbatim quotes), `closest_alternative` (a type id or null). A maximum output token cap is set on every call (used in §6.4). Persist raw BEFORE parsing. Validate: one verdict per defined type, no extras; `model` equals the pin else blocker `E_TERRA_PIN_DRIFT`. Schema failure → one identical retry → per-document failure `E_READER_SCHEMA`.

Five per-type reader calls (one per type, each with only that type's definition) is a bake-off variant, not the default (§10).

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

### 5.7 Run modes

One pipeline; two transports to the reader, chosen by the user before upload:
- **Interactive** — synchronous reader calls; results appear as documents complete; above the account's OpenAI rate limits the run slows down waiting.
- **Batch** — OpenAI Batch API; lower cost; results arrive together; completion window up to 24 hours.
Both MUST use the same pinned snapshot and prompt; results are identical by construction. The page states the projected duration for each before the user chooses. The default is set by the pack's document-count cutoff.

### 5.8 Manifest and run closure

When every document has an outcome, the run produces the manifest (§1). The user downloads it. The run is **closed** when the user downloads the manifest or closes it explicitly. On closure the cloud deletes the uploaded text and outline and retains: decisions, rule ids, vendor responses, digests, fingerprints, filenames, notes, versions, and the manifest. Text is NEVER deleted on a timer. The run page shows whether text is still held.

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

## 7. Local builder

Runs in the browser after the manifest is downloaded. The user picks the source folder and a destination.

- Matches each manifest entry to a local file by fingerprint. Not found → listed under "not found in source folder"; never skipped silently.
- Copies (never moves, by default) each file into its destination folder with the tag prefixed to the filename. Idempotent: skips a destination that already holds the same fingerprint.
- Writes a sidecar `.md` beside every file in `human_review/` and `could_not_process/`: what the confidence check said (choice, certainty, per-type yes/no), what the reader said (per-type verdicts, rationales, evidence), the rule that fired, and what the person needs to decide. A top-level summary lists counts and every file.
- Warns before writing if a path would exceed OS limits and offers shorter naming.
- Resumable; progress in files, not bytes.

## 8. Correction

The person moves files between folders in the built tree. Then, on the run page, they point the browser at the tree.

- The browser reads folder paths and filenames. Files are matched to manifest entries by **tag first**; untagged files by fingerprint; unmatched files are listed. Only a small listing is sent; documents are never uploaded.
- The person is asked **which folders they checked**. Only checked folders count as confirmations; unmoved files in unchecked folders mean nothing.
- Every file in a checked folder that did not move is a confirmation. Every file that moved is a correction: to another type = misfile; to `human_review/` = should not have been auto-filed; from `human_review/` to a type = a human label.
- Deleted files are listed and excluded. Junk (`.DS_Store`, `Thumbs.db`, `__MACOSX`, our sidecars) is ignored.
- A folder that is not a type and not reserved → one question: "New type, or ignore these?" Ignored files are excluded. New-type folders produce a **stub** (§9).

**Output — at most three sentences plus a table of every move:**
1. Filed-folder check: "*x* of *n* filed documents were wrong" (counts, never a percentage alone). If the misfiled documents all had lower certainty than the correct ones: "Raising the threshold to *T* would have sent them to review and *k* correct ones too. Apply?" If not: "The threshold cannot separate these. Look at these documents and the definitions of *A* and *B*." No threshold recommendation is made when the filed count is below a minimum (default 50); counts are still shown.
2. Review-folder mirror: for review items where both systems agreed below threshold and the person placed them where the systems agreed: "Lowering the threshold to *T'* would have filed *m* of these automatically with *e* errors. Apply?"
3. New-type and unmatched summaries.

"Apply" writes the threshold to D1 with this correction as justification. Nothing else changes automatically.

## 9. Improvement loop

From each correction the system **proposes**, and a person accepts or rejects in the type file:
- Confirmed and human-labelled documents → candidate `examples` for their type (title and digest lines).
- Misfiles between two types → a candidate `not_for` sentence naming the pair.
- New-type folders → a stub entry: proposed `id` and `name` from the folder name, the placed documents as candidate examples. `what` and `not_for` are left for the person; the system cannot know what makes a type distinct.

Until a stub is completed and deployed, the folder is honoured in the tree and labelled "proposed type, not yet defined." After deployment, both vendors receive the new type on the next run because both requests are generated from the type file. Jev's option ceiling is 255 including `none_of_these`.

## 10. Bake-off

There is no labelled set before the first run. The first run of a project uses the initial threshold (0.90) and its corrected tree is the dataset. Variants are then re-run offline against that corrected batch and compared on **auto-file precision** and **review load**:
- one reader call with all types vs five per-type calls;
- reader effort `low` vs `medium`;
- digest budget 6,000 vs larger;
- Sol vs Terra on the documents that landed in review.
The more accurate configuration is adopted and recorded with the numbers. Re-run after any pin change.

## 11. Platform, UX, observability

**Platform.** Worker (API + UI as static assets) behind Cloudflare Access (configure protection for this installation; do not change unrelated applications). Workflows per document. R2 for immutable per-attempt artefacts. D1 for runs, documents, events, decisions, corrections, threshold, vendor calls. Workers Secrets for keys. UI polls D1 for progress. Not used: Durable Objects, Queues, containers, AI Gateway, Workers AI, Vectorize, Python. Language: TypeScript throughout; the extractor is shared code between the browser and any server-side use.

**Verified limits designed around** (Cloudflare docs, 2026-09-21): 128 MB memory per isolate, shared across concurrent requests; CPU per step 30 s default, configurable to 5 min; step return ≤ 1 MiB; 50,000 concurrent Workflow instances, 300 created/s per account and 100/s per workflow (429 above); up to 10,000 retries per step (set ours explicitly); Worker bundle 64 MiB uncompressed, 1 s startup — import pdf.js lazily, keep schemas out of global scope. Vendor: Jev 1,200 rpm published and dynamic; Terra per account tier; Batch window up to 24 h.

**UX.** Design reference for visual language only: `ui/reference/leadership-demo.html` — it is not an architecture reference. Principles: say it before the wait (preflight on load and before upload; cost and duration before confirm); progress measured, never invented; outcome colours fixed and never reused (filed / review / could-not-process); one primary action per screen; technical detail behind a disclosure; light and dark, WCAG AA; reduced-motion disables transitions only. Screens: Home (browser check, source folder, projected cost/duration, mode, confirm), Run (progress then results, live spend, kill switch, download manifest, close run), Build (builder), Correct (drop tree, checked-folder question, sentences, moves table, Apply), Health (versions, pins, vendor status, threshold and its justification, text-held status, probes). Copy: *confidence check*, *reader*, *decision rules*; model names only in Health and details; never "fast"; "filed" means both agreed with certainty at or above threshold and is never applied to anything else.

**Observability.** Every stage writes a typed event to D1 with measured timings; every vendor call a row (vendor, model requested and returned, status, latency, request id, tokens, attempt); every run records type version, pins, threshold and its justification, mode, budget decision, extractor versions. Raw vendor responses in R2, one key per attempt.

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

## 13. Deliverables

The system, deployed via CI-gated `wrangler deploy`, with a `/health` page reading READY or NOT READY with numbered blockers and the sentence to send the technical contact. `How It Works.html`, served by the app, for non-technical users (what it does, where documents do and do not go, what to expect, "when something goes wrong" table, FAQ). `HANDOFF.md` for the next engineer or agent (stage map with entry points, pins and bake-off numbers, §4/§5.6/§6/§12 verbatim, invariants relied on, gotchas, open issues, deploy runbook). `AGENTS.md`. The bake-off readout for the configuration in production. Tests covering at minimum: every row of §5.6 with threshold boundaries and determinism; vendor validators against every malformed shape including alias model strings; the failure policy with mocked vendors; the digest (deterministic, structural-first, outline never trimmed, budget failure raised, notes emitted, vocabulary collision rejected, selection log complete); outline recovery rejecting any non-verbatim heading; step idempotency; the cost ceiling arithmetic and the override recording; the correction diff (tag and fingerprint matching, checked-folder scoping, each move class, unrecognised folders); the builder's idempotent copy and not-found listing; the browser gate.

## 14. Open for the owner

- Confirm the account is on Workers Paid and note the OpenAI tier (the agent checks and records both).
- Reader effort default `low` until the bake-off says otherwise — confirm.
- Minimum filed count before a threshold recommendation (default 50) — confirm.

*End.*

## Owner-approved implementation amendments (2026-09-22)

These explicit owner decisions supersede conflicting original statements above:

- Terra and Luna may use the family names gpt-5.6-terra and gpt-5.6-luna without dated snapshots. Preserve both requested and returned model IDs and reject unrelated model families. Jev remains version-pinned. No Sol alias was authorized.
- Build a generic unconfigured project first. Taxonomy and examples remain customizable project-pack data, supplied iteratively; do not invent production definitions or a spending approval.
- Git is authoritative for project definitions. Deployment activation is commit-based through Cloudflare/GitHub CI/CD, not browser editing of taxonomy.
- Cost ceilings include every permitted billable attempt and outline recovery.
- Target Workers Paid and verify service availability during installation. Initial implementation settings are threshold 0.90, digest budget 6,000, reader effort low and minimum checked filed sample 50.
- Live paid model calls remain disabled pending the owner's key-replacement/activation instruction. Checking Secret Store accessibility does not authorize paid inference.

### Verified vendor clarification (2026-09-22)

The original section 12 rationale calls the extra Nouls zero cost. Current TypeSafe guidance says additional questions consume tokens. Keep the approved Choice-plus-Nouls design, but include all questions in request token accounting and spending; do not promise zero marginal cost. Source: https://docs.typesafe.ai/primitives and the owner-added SKILL.md.


### Portable deployment requirements

Independent owners deploy through Cloudflare browser setup onto a workers.dev URL, without a custom domain or local installation. Each owner supplies their own credentials and approves their own spending limit. Project definitions remain Git-led. Worker-specific Access setup is permitted for the installation; unrelated Access applications and policies must remain unchanged. Unknown account throughput is disclosed rather than treated as a missing model capability. Model calls remain disabled until explicit owner activation.

### Owner-approved per-run monitored spending (2026-09-22)

The owner replaces mandatory pre-upload cost prediction with a website budget choice at the start of every run. This supersedes the projected-cost ceiling and project-budget approval gates in sections 3, 5.1, 6, 6.4 and the corresponding section 12 rationale.

- Before any metadata or text upload, the person chooses limits in USD for blended (OpenAI plus TypeSafe), OpenAI, TypeSafe, or any combination. A blank category is explicitly unlimited in that category, not zero. At least one positive limit is required in limited mode.
- Running with no limits is a separate explicit mode with a prominent warning and an unchecked acknowledgement required before confirmation. Record the limits or unlimited choice, signed-in actor and timestamp immutably for that run. A retry is a new run with a new budget decision.
- Spending comes from vendor-reported API usage at the run's recorded verified prices, including all attempts and OpenAI outline recovery. Show combined, OpenAI and TypeSafe subtotals and their limits. Preserve raw responses before accounting. Missing usage is unknown, never zero; it remains visible and blocks further inference when accounting cannot be established.
- Stop new vendor inference when any configured limit is reached or exceeded. These are monitored stop thresholds, not guaranteed invoice caps: in-flight parallel calls and previously submitted Batch work may continue incurring charges before usage arrives. Explain this before confirmation. Continue recording already-incurred costs after stopping; never show a partial run as complete.
- No exact request-billing tokenizer or recovery cost ceiling is required. Unknown token counts and duration remain explicitly unknown. Provider context limits still apply, and requests are never chunked, trimmed or changed to recover from a context rejection.
- The official Jev tokenizer is still required for the unchanged 6,000-token digest, separately from billing. No substitute tokenizer is approved. Verified model prices, raw usage accounting, kill switch, unchanged classification rules and each deployment owner's separate validation authorization remain in force. Cloudflare infrastructure charges are outside model-usage totals.

### Owner-approved response token counts and untrimmed state (2026-09-22)

The owner instructed the implementation to drop local token counters and use Jev response usage, following the TypeSafe skill. This latest instruction retires the earlier official-tokenizer dependency and the 6,000-token selection/trimming requirement in section 5.3 and subsequent amendments. The implemented policy is explicitly versioned as untrimmed-structured-state-v2.

- The confidence check receives full extracted text and document structure, without a local token counter, character substitute, truncation or chunking. The reader continues to receive full extracted text. This changes the confidence-check input; it is not claimed equivalent to the old digest.
- Token usage and model spending come only from validated vendor responses. Counts before a response remain unknown, never fabricated or treated as zero. Raw responses are persisted before parsing and accounting. Existing per-run monitored limits and warnings about delayed usage remain binding.
- Published provider context limits still apply. A rejected oversized request fails explicitly; no changed-request retry or automatic shortening is introduced. All deterministic decision rules, model identity validation and verbatim heading-recovery checks remain unchanged.
- The full structured-state artifact contains source text and is marked for deletion on user-driven run closure along with uploaded text and outline. Historical compact digests retain their historical treatment. No timer deletion is introduced. Corrections disclose when text excerpts are unavailable instead of recreating them.
- Project packs record the new policy. No official tokenizer delivery is a readiness blocker. Model activation, storage/authentication checks, a valid taxonomy and verified prices are still required. No live validation or bake-off accuracy is claimed for this input change; validate it before adopting accuracy conclusions.

### Full-text structural-note policy (2026-09-23)

For new runs explicitly configured with untrimmed-structured-state-v2 and full-state-structural-info-v2, retain N_NO_OUTLINE, N_NO_STRUCTURAL_SECTIONS and N_OUTLINE_RECOVERED as informational provenance. Full extracted text remains supplied, so these known heading/outline notes alone do not force review. Other notes still require review; all extraction, vendor, model, schema, evidence and recovery-verification failures still block filing. R1 through R5 agreement, Noul and certainty conditions are unchanged. Historical runs and manifests keep their original rules and decisions; do not relabel them. New project packs must explicitly choose a recognized note policy; only already-frozen historical packs with the setting absent retain all-notes-review-v1.

### Owner-approved reader default (2026-09-23)

The owner approved GPT-6 Sol for new project configurations under `owner_approved_alias`. Accept only its exact named identity or a same-family dated identity, preserving the returned identity. Historical frozen GPT-5.6 Terra configurations remain valid. GPT-5.6 Luna recovery, Jev, prompts, effort, output caps, taxonomy and threshold are unchanged. This supersedes the earlier statement that no Sol alias was authorized; no fallback or historical relabeling is permitted. Independent deployment owners still authorize their own spending and validate their own project.


### Simplified sign-in setup (2026-09-23)
The owner stopped fresh-install acceptance and requested removal of manual Access audience/team setup. New generic installations use Cloudflare's trusted request-scoped Access context with built UI text modules served directly by the Worker; no Static Assets router, manually supplied AUD/team, account control token in the application, or first-visitor ownership claim. Until Cloudflare has authenticated the visitor, the public app exposes only its static setup interface and minimal sign-in status; document, project and run APIs stay locked. The owner enables protection for the specific Worker and chooses authorized people in Cloudflare; the application reads the resulting authenticated identity automatically, with no identity-only Git edit or redeploy. Existing owner deployments retain configured JWT verification and historical actor IDs. Classification configuration, Git-led changes, explicit activation and spending permissions are unchanged. Progress hooks remain disabled.


### Owner-approved full-text request compaction and GPT-6 Luna recovery (2026-09-23)
Following an actual Jev max_tokens_exceeded rejection during the owner-started corpus run, the owner instructed that request inflation be fixed upfront and explicitly promoted heading recovery from GPT-5.6 Luna to GPT-6 Luna. New project packs select full-text-outline-v3: transmit the exact fullText once plus all heading and table-header metadata; canonical extraction/fragment records remain stored with source data but are not duplicated into the Jev request. No summarization, truncation, character/token proxy, document chunking or automatic fallback is introduced. An absent title is explicit null rather than a copy of the document body. Confidence instructions reference fullText and its metadata under the new version. Full-text informational structural-note behavior remains; deterministic filing conditions and threshold stay unchanged. Frozen v2 runs keep their original request builder/wording; historical runs/results are never relabelled or resumed by this change. Source-containing compact artifacts still follow explicit run closure deletion.
GPT-6 Luna is approved only for heading recovery under the owner-approved family-identity exception. Keep the recovery prompt, low effort,8192output cap,exact-line verification and no-fallback behavior. Preserve old Luna5.6 frozen packs and billing. Standard recovery pricing verified at USD0.10input/0.50output per million, with published long-context multipliers; recovery remains interactive even in reader-Batch runs. Existing two-case paid recovery comparison supplies limited evidence; production request hashes match those candidates. No new paid replay is authorized or claimed by the offline promotion check.
Compaction reduced byte volume across114local sources while preserving exact full text/outline, but bytes do not prove vendor token fit or classification equivalence. Provider size limits still apply; rejected requests are not silently shortened/retried, and missing usage remains unknown. New inputs need live owner-run/evaluation evidence before quality claims. This is a full-text representation repair, not implementation or selection of the separate structural-N digest proposal in the author's response.


### Approved website feedback loop and evidence comparison (2026-09-24)
User-authored category sets may now use explicitly selected runtime mode: immutable D1 revisions, owner-configured editor allowlist, explicit stale-safe activation, frozen per-run definitions for both vendors and separate display names. Git remains authoritative for software and deployment setup; legacy Git definitions remain an explicit mode. Semantic changes reset threshold to0.90 unless explicitly inherited and marked unverified; display-only cosmetic changes preserve calibration. No first-visitor editor claim or automatic activation from corrections.
Owner-confirmed labels are authoritative; agent judgments advisory. Explicit either-A-or-B labels require no folder move and are excluded from misfile denominators. Follow-up runs link to confirmed corrections by fingerprint and report moved-target matches and previously-filed stability, separately counting ambiguous/excluded/missing/new/failed documents. Originals stay local; no cloud evaluation corpus. Normal category editing/activation needs no Git or intermediate JSON download.
The connected UI and its accessibility are part of acceptance: AA contrast both themes, purposeful reduced-motion-safe transitions and plain-language explanations. Source/tests/local fixtures are not deployed or uncoached usability acceptance. A1-A4 and policy comparisons remain tracked after this milestone; GEPA deferred and background hooks disabled.
New packs may explicitly select readerEvidencePolicy whitespace-quotes-v1: map curly single/double quotes to ASCII, collapse whitespace runs on both sides and require a nonempty contiguous substring. Preserve returned quotes exactly. No word/case/order/number changes, dehyphenation, ellipsis repair, table-heading splicing or fuzzy matching. Historical packs without the field retain exact-substring-v1; unknown versions fail. Policy recorded per validated artifact and run/results; heading recovery remains exact. Historical results never rewritten. See docs/evidence-comparison.md.


### Explicit unlimited-run unknown-spend isolation (2026-09-24)
Owner-approved newpacks select unknownSpendPolicy isolate-unlimited-v1. An unknown-cost request in an explicitly acknowledged unlimitedrun fails only thatdocument without automaticretry; unrelateddocumentscontinue. Persist unknowncharges asnull, displayknownsubtotal andunresolvedcount, and distinguish completeclassification fromfinalbilling. Cappedruns stillstopnewinference whenunknowncostpreventsbudgetverification. Kill/modeldisabled/authentication/modelidentity/storagechecksremainmandatory. Legacyfrozenpackswithoutpolicyretain halt-on-unknown-v1; historicrunsarenotrestarted orrewritten. Furtherworkrequiresanexplicitspendingdecision. Batchaccountsallalready-submittedresults andisolatesunknowncostbeforeretry. Typedguarderrorsmustnotbemislabelledasrawpersistencefailures. No usagearithmeticrounding,pricechange orclassificationrulechange introduced. See docs/run-spending.md.


### Completed checkpoint acknowledgements and explicit continuation (2026-09-24)
The exact observed Workflow inactive-instance error at the outer step.do boundary can recover an already-complete durable D1result, without repeating the action. Callback-origin errors and unconfirmed outcomes remainfailures; no blanket vendorretry. Owner-controlled continuation reusesfrozenruninputs/settings/spending andcompletedpaidcheckpoints via immutable recoverygeneration/newexecutionIDs, preservingoldWorkflowhistory. Refuse activeoldexecutions,unknownspend,incompletecheckpoints/artifacts,missinginputs oranysubmittedBatchjob. Originalkill/model/contract/budgetchecks and explicitconsent remainmandatory. Stalegenerations cannot submitwork orhalt thecontinuedrun. EphemeralBatchwaitingobservations usefreshgenerationnames; paidstepkeys stayunchanged. Thisphase supports infrastructurestops before readerBatchsubmission; testsare localfaultinjection,notproofofarbitraryplatformtakeover. See docs/run-recovery.md.
