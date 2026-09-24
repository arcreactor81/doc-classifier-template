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

## Full structured state and response usage (2026-09-22)

The current policy untrimmed-structured-state-v2 replaces the former 6,000-token digest and local tokenizer dependency. Full extracted text and outline reach the confidence check; counts come from vendor responses. Pre-response counts remain unknown, missing usage never means free, and existing per-run monitored limits still apply. Provider context rejection fails explicitly without shortening or changing the request.

Full-state artifacts are marked as source text and deleted on user-driven closure. Corrections disclose unavailable example excerpts instead of reconstructing them. Existing classification rules, raw-response-first accounting and local-only original documents remain binding. The unsent tokenizer request is archived. No paid validation or accuracy result is claimed for this changed input.

Implementation verification passed 188 tests, both TypeScript checks and production UI build. Browser verification passed 8 UI unit checks, 12 budget display/privacy checks and 14 confirmation/upload checks, using real local preparation without tokenizer interception and fixture APIs without vendor calls. This public export is independently checked before release.

Reviewed [Python Workers GA](https://blog.cloudflare.com/python-workers-ga/) on 2026-09-22; retained TypeScript because no required feature needs Python and original extraction belongs in the browser. Fresh-account deployment acceptance and authorized live validation remain outstanding.

Release integration review found and fixed the confidence adapter rejecting the new fullText field. A regression now passes the actual structured-state builder output into request construction and checks exact preservation plus rejection of malformed/extra fields. The final export gate is rerun after this fix.

Final sanitized export verification: 189 tests passed, both TypeScript checks passed and the production UI build passed. No deployment or vendor inference occurred during verification.

## Workflow instance identity repair (2026-09-22)

Concatenating a run UUID and full document fingerprint produced a 101-character Workflow instance ID, exceeding Cloudflare's 100-character maximum. Instance IDs now use a stable 68-character value: doc_ plus SHA-256 of the complete framed run/document identities. Neither identity is truncated. Classification requests, decision rules and document content are unchanged. A halted run is not retried automatically. Three focused tests cover the supported alphabet/length, determinism, full identity contribution and invalid inputs.

## Transport compatibility, recorded health and correction UI (2026-09-22)

Workers fetch now uses manual redirect handling and explicitly rejects redirects after recording the response; credential-bearing requests are never followed to another URL. The same handling covers interactive requests, Batch operations and Batch closure. A real Workers-runtime regression uses only a local loopback server. Transport-focused verification reported 33 passing checks without vendor calls; combined release verification remains separate.

Health reports recorded vendor history and unknown accounting instead of always saying no vendor was contacted. The UI shows threshold and justification, binds correction listings to the selected manifest/run, clears stale scan state, presents proposed examples/exclusions/types and downloads their exact JSON for Git review. These are proposals, not automatic classification changes. Focused browser checks use fixture APIs; no production corrections are applied.

Final sanitized release gate passed 199 tests, both TypeScript checks and the production UI build. The runtime transport regression used a local loopback server only; no vendor calls occurred in release verification.

## Browser setup guidance and local acceptance coverage (2026-09-22)

The browser deployment guide now distinguishes the deploying owner's cloud setup from website users' sign-in, confirms public template availability, and explains enabling inference only after all other Health blockers are resolved. Fresh-account provisioning, Access sign-in and authenticated API acceptance remain unverified; no local installation is required by the intended owner setup flow.

Added reproducible acceptance scripts. The builder exercise passed 19 checks using actual Chromium origin-private filesystem handles, writes, Web Locks and native moves; its picker is injected and native desktop dialogs remain outside coverage. The correction exercise passed 26 checks using local workerd, D1/R2 and locally signed authentication, covering manifest closure, text deletion, stored corrections and explicit threshold application. Its source records are synthetic, every non-fixture outbound request is denied and it makes no vendor calls. These checks establish local behavior, not live model quality or fresh-account deployment acceptance.

## Exact reader evidence instructions (2026-09-22)

The owner approved a generic clarification to the reader prompt, versioned reader-exact-evidence-v2. Evidence strings must copy exact contiguous source substrings, preserving whitespace, line breaks, punctuation and source quotation marks without added formatting. The strict verbatim validator is unchanged; no output repair, fallback or changed-request retry was added. Confidence and recovery prompts are unchanged. Quotes record the reader prompt version.

The regression verifies JSON-decoded Unicode code points, multiline text, tabs and literal quotation marks, and retains rejection of normalized or rewritten evidence. Holdout validation of this prompt version remains pending; this release claims no model-quality or bake-off result.


### PowerPoint structural correction (2026-09-22)
Extractor1.0.2 resets heading context at slide boundaries; untitled slides cannot inherit prior slide titles. Exacttext, table/notes order and source offsets preserved. Supported formats PDF/DOCX/PPTX now explicit near folder selection; legacyDOC/PPT rejected. Regression red beforefix thenpass; full202test/type/build gate verified in source installation. Livecross-format acceptance remains separate; no accuracy claim.

## Audited result and correction flows (2026-09-22)

Run tables now show stored outcomes, reasons and priority-one disagreements, rather than treating completed processing as a classification label. Typed API errors expose their recorded headline/action while keeping raw diagnostics separate. Per-document validated vendor evidence loads only on explicit request through an owned-run endpoint; it neither reads source state nor closes the run. Configured document-count mode defaults now populate the selector while preserving user choice.

Failure sidecars retain actual failure details. Correction proposals can include exact retained reader quotes with originating type/verdict and artifact/index provenance, including negative verdicts. Frozen type definitions support conditional exclusion candidates; full-context limitations remain explicit and nothing applies automatically. Full document state is not retained for these proposals. Legacy digest/cost module documentation now identifies active versus historical behavior.

Combined implementation gate passed 220 tests, both TypeScript checks and UI build. Focused acceptance includes typed errors/evidence and proposal browser checks plus local workerd correction persistence. These are implementation checks, not a model-quality or fresh-account deployment claim. Structural-note filing policy remains unchanged.

## Responsive interface, Office text and rate-limit refinements (2026-09-22)

The interface now has responsive workspace navigation, a clear local workflow overview, polished setup/budget/evidence/proposal cards, and narrow-screen document result cards. Light/dark themes, fixed outcome colors and reduced-motion behavior are retained. Existing confirmation, original-file privacy and classification rules are unchanged. Setup mode suggestions no longer require a complete taxonomy, while full run readiness still does. No external font or UI framework dependency was added.

Office extractor1.0.3 reads explicit Word/DrawingML text carriers and skips XML indentation, retaining source text spacing/tabs/breaks and namespace-aware text. This prevents serialization whitespace from becoming document content. Targeted DOCX namespace/spacing coverage accompanies the change.

Permanent OpenAI quota/billing429 errors now stop with an actionable blocker after raw accounting, without repeating inference. Temporary Batch metadata-poll429 responses receive bounded durable read-only retries. Batch result-file GET429 retry remains an explicit reliability gap; no uncertain upload/create is replayed.

Combined implementation gate passed228tests, both TypeScript checks and UI build. Frontend acceptance included15layout/theme/reduced-motion checks,14confirmation,22correction/health,19realOPFSbuilder,11error/evidence,16proposal and5mode checks. Six screenshots were visually reviewed. These are fixture/local acceptance checks, not new model-quality results or a fresh-owner install claim.

## Product walkthrough and coordinated waiting (2026-09-23)

Added the user walkthrough covering folder selection, per-run budgets, recorded evidence, deliberate manifest closure, local folder building and correction proposals. Confirmed upload progress stays visible while the request is working. Open evidence panels refresh incomplete results during run polling, while immutable terminal results remain cached.

Recorded provider cooldowns are shared through D1 and displayed only while applicable; stale shorter events cannot hide an active longer wait. Configured request admission and temporary read retry paths retain existing guards and unchanged request bytes. New installations opt into a distinct Workflow-name marker: the cloud deploy script derives a stable valid name from selected Worker/binding identities in a temporary sibling config, preserving relative paths and removing that file after success or failure. Existing names and configurations do not migrate silently. Migration0005 provides the cooldown ledger.

Private implementation verification passed258tests. The public template intentionally excludes the existing-owner deployment driver and its2tests; its own release gate is recorded separately. No private validation corpus results, reviewer records, spending ledger or original operational handoff were exported. These improvements establish product mechanics, not model-quality, bake-off or fresh-account acceptance claims.

Final public export verification: 256 tests passed, both TypeScript checks passed and the production UI build passed. The two private-only owner-deploy tests account for the difference from the 258-test private gate. Portable package scripts and other configuration remain unchanged; only the explicitly authorized new-install Workflow marker changed.

## Informational structural notes for new full-text runs (2026-09-23)

The generic starter now explicitly selects full-state-structural-info-v2 with untrimmed-structured-state-v2. Missing, unmatched or recovered headings remain visible as provenance and no longer force review by themselves. All other notes retain review precedence; all failures still prevent filing. Agreement, Noul and certainty conditions are unchanged. Historical frozen packs without this new setting retain all-notes-review-v1, and historical decisions/manifests are not relabelled. New packs require an explicit recognized compatible policy.

The exact approved policy regressions failed before implementation and passed after it. The public release gate passed 262 tests, both TypeScript checks and the production UI build. No model, prompt, output cap, spending authorization or deployment configuration changed; these checks make no live accuracy claim. No vendor calls or remote changes were made while preparing this candidate. Only the generic policy implementation and user guidance were exported; private operational notes, evaluation harnesses and validation results remain excluded.

The already-public sanitized validation fixture received only the same explicit decisionNotePolicy setting so it remains compatible with the new loader; none of its taxonomy, source list or spending configuration was imported from a private pack. Its local correction acceptance passed 31 checks using synthetic records and denied external requests, with zero vendor calls or remote mutations. The candidate privacy scan covered all 160 tracked source files and the 12-file change allowlist, found no known private identifiers or credential patterns, confirmed exact approved source for the nine exported implementation/generic files, and confirmed vendor evaluation seams were excluded.

## Approved reader default (2026-09-23)

The generic starter and existing sanitized validation fixture now select GPT-6 Sol, with role-scoped alias and dated-identity checks in both configuration and request validation. Historical Terra configurations remain accepted. GPT-6 Luna is rejected for the reader and recovery roles. The existing GPT-5.6 Luna recovery, Jev, prompts, effort, output caps, type definitions, decision rules and spending configuration are unchanged. The public fixture received only the reader pin and verified pricing updates.

Verified the official [GPT-6 Sol model page](https://developers.openai.com/api/docs/models/gpt-6-sol) on 2026-09-23: Responses and structured outputs, low effort, the existing context allowance, Standard USD 2 input / USD 10 output per million tokens, half-price Batch and the existing long-context multipliers. The five new synthetic regressions failed before implementation. They cover role separation, strict returned identity, unchanged request content, exact evidence, historical configuration loading and identical retries without fallback. The release includes no private evaluation code, corpus results, operational identifiers or spending approval. Independent-owner acceptance and project-specific quality validation remain separate requirements.

Public release verification passed 267 tests, both TypeScript checks and the production UI build. No vendor calls or remote mutations were made while preparing this candidate.

The public privacy audit covered all 160 tracked files and the 11-file change allowlist. It found no known private identifiers, credential patterns or evaluation seams, and verified that both project packs retain their prior taxonomy and spending configuration.

## Correction input errors and current action message (2026-09-23)

Correction listings with invalid paths, a checked tree root, duplicate paths or multiple copies matching one document now return typed HTTP 400 request errors with specific next steps. Missing or duplicate saved manifest identities remain an HTTP 409 blocker. Unexpected failures remain HTTP 500 without exposing exception contents. The UI replaces the current action error, clears it after successful manifest selection, tree scanning or correction review, and explains selecting the whole output folder. Classification results, original files and correction proposals are unchanged; rejected listings create no correction artifacts or threshold updates.

The change preserves strict validation and exposes its cause instead of rewriting the listing or interpreting an ambiguous document automatically. Regressions use synthetic records and intercepted or local requests. This export changes no model, prompt, classification policy, taxonomy, project setting or deployment configuration, so no bake-off rerun is required. Production deployment and authenticated Health verification are separate from this local public-template verification.

Independent public verification passed 274 tests, both TypeScript checks and the production UI build. The browser action-error regression passed 16 checks. Local correction acceptance passed 67 checks, including typed rejection responses and unchanged correction artifacts and threshold state after invalid listings, with all vendor requests denied. The privacy audit covered 162 source files and the 10-file change allowlist, found no known private identifiers or credential patterns, verified all nine shared files byte for byte, and confirmed public project packs and deployment configuration remain unchanged. No vendor calls or remote mutations occurred.

## Correction feedback follows its action (2026-09-23)

Correction review now shows its pending state and current error directly below the Review corrections button. Successful review clears that status and displays the correction results below the action. A repeated review after resolving unknown folders uses the status beneath that review button as well. This places feedback in the reading order without changing correction payloads, validation, proposals or classification behavior. The README records the same placement rule for future progress, success and error feedback. The existing local API acceptance remains applicable because server and correction-domain files are unchanged.

Public follow-up verification passed 274 tests, both TypeScript checks, the production UI build and 22 browser regression checks. The privacy audit covered all 162 tracked files and the four-file change allowlist with no known private identifiers or credential patterns, and all nine shared correction files still match their reviewed source exactly. The prior 67-check local API acceptance applies to unchanged backend and acceptance files. No vendor calls or remote mutations occurred.


### Website category and feedback release candidate (2026-09-24)
Immutablecategoryversions/editorallowlist/explicitactivation, revisionthresholds, ownerreferenceambiguity, fingerprintlinkedcomparisons andconnectedUIimplemented. Public335unit tests;147nativeidentity,41runstop,30definitionAPI,41feedbackAPIchecks passed usinglocalfixtureswithoutvendorcalls. Browserfixtureflowand48themecontrastpairs min5.56:1passed. Noautomaticactivation orhistoricalresultrewrite. Liveowneractivation, actualsecondrunimprovementcounts anduncoachedusabilityremainpending. Newversionedformattingonlyreaderevidencecomparisonpreservesrawquotesandlegacystrictbehavior.
