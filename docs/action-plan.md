# Remaining implementation actions

- [ ] Acceptance-test browser-only Deploy to Cloudflare on a fresh account with workers.dev, secure keys, D1/R2/Workflow provisioning and Access sign-in/denial.
- [ ] Verify local token accounting and outline-recovery cost bounds.
- [ ] Activate a configured project only with its owner's explicit spending approval.
- [ ] Run a public-document validation baseline and permitted bake-off variants; report measured results without treating provisional labels as human corrections.
- [ ] Validate browser-led updates from the owner's Git repository.

No custom domain, local Node/CLI/app installation or coding harness is required for the intended deployment flow. Coding harnesses are optional for later customization. This list states goals; deployment acceptance is not yet claimed.


## Owner UX acceptance update: dedicated run window and full redesign

The owner does not accept the latest workspace refresh as the final design. Reimagine the information architecture, visual direction and end-to-end task flow; another cosmetic restyle is insufficient. Earlier functional/layout tests establish working controls, not owner design acceptance.

- [ ] After an explicit Start run confirmation, open a dedicated run-monitoring window and keep the main workspace available. Handle browser popup restrictions with an explicit usable link rather than silently failing. A new window must not create a second run or duplicate submission/spending; preserve run ownership, budget confirmation and local upload continuity. This behavior is requested, not implemented.
- [ ] Redesign the overall experience around nontechnical tasks and clear next actions. Preserve originals-local privacy, honest measured status, deterministic decisions, accessibility, light/dark and reduced-motion behavior.
- [ ] Validate the complete sequence: run, results download, three build selections, personal folder moves, and whole-output-folder correction review. Guidance must be complete in the repositories and in the app without relying on this chat.

No runtime change or deployment is performed by recording this feedback, especially while the owner's calibration run is active.


### Owner feedback: no visible activity after upload

During the live114-document run, the owner reported that the website appeared idle after text upload while backend processing was active. This is a usability defect, not evidence that processing stopped. The redesigned run flow must open/show monitoring immediately after run creation or upload completion, rather than waiting for all Workflow dispatch batches to finish. Show honest stage states: local extraction, uploading, upload accepted, queued/dispatching, heading recovery when needed, confidence check, reader, validation/decision, and completed or stopped. Distinguish per-document and aggregate progress, show live known/pending/unknown spending, explain provider waits/errors, and use recorded backend events rather than decorative timers or invented percentages. Keep the planned dedicated run window and main workspace available. Do not duplicate submissions when navigating or opening the monitor. This entry records a requirement; no UI deployment occurs during the owner's active run.


### Owner-selected visual/motion reference: TRON: Legacy

Use TRON: Legacy as a specific reference for the full UI reimagining, especially loading screens, loading/progress bars, transitions and movement between tabs/views. Explore an original dark graphite/cyan luminous visual system, geometric tracks, light trails, staged reveals and cohesive transition choreography rather than another conventional card repaint. Do not copy film stills/logos or rely on external media/fonts. Map motion to actual application stages/events; known counts may drive determinate progress, unknown-duration vendor waits must remain explicitly indeterminate. Preserve clear task explanations, fixed outcome colors, legible light/dark variants, keyboard focus and reduced-motion accessibility. The owner has not accepted the current refresh as the target design. This is recorded inspiration and acceptance direction, not a shipped feature.


### Owner feedback: one continuous resumable pipeline

The owner reports that the current workflow feels disconnected: starting a run, results, downloading, building and corrections live in separate tabs without a reliable handoff. The completed-run Build folders action looked as if it would carry results forward, but currently only navigates to the Build screen. The owner therefore skipped the download and reached the next step without its required results file. This is a product-flow defect, not user error.

The full redesign must present one end-to-end, resumable journey: choose inputs ? confirm/run ? monitor ? review results ? build local folders ? correct/review. Persist the active run identity, current workflow step, relevant results and local selection context; transparently request renewed browser file permissions when needed. Automatically carry the correct run's results into the builder or explicitly obtain the missing prerequisite before advancing. Never silently reuse a different run's previously selected results. Keep results-file export available as backup/portability, not a mysterious mandatory manual transfer between screens. Separate results retrieval from user-authorized run closure if required, so navigation does not silently delete held cloud text. The dedicated run window should participate in the same saved session rather than becoming another disconnected task. Exact interactions will be decided in the redesign.


### Pending UI: visible results-download/closure indicator

Owner requests a visible indicator immediately below Download results file and close run. The action can spend substantial time assembling results and deleting held extraction artifacts before the browser receives its download. Show honest preparing/closing/waiting state immediately, remain visible until completion/error, and report measured cleanup progress only when supplied by the backend. Do not imply the browser saved a file merely because the download was initiated. Owner explicitly deferred this to the full UI upgrade; do not implement or deploy it during their current folder-building/correction work.


### Pending UI: folder handles and safe output placement

Folder selection should be sufficient for normal building; do not require users to retype a path. Browsers supply a folder handle/name, not an absolute path. Keep optional absolute-path input only as clearly explained advanced path-length checking, without pretending it was extracted. Detect and prevent selecting the source folder or one of its descendants as the destination: otherwise future recursive source scans include generated copies. The owner's accepted114-file build currently produced source/output; originals were not moved or edited. The correction picker must select that output root, not its parent source. No automatic filesystem relocation was performed during interactive review.


### Pending UI: category checklist during human correction

The owner created a proposed Information Dissemination folder and reported uncertainty about whether earlier moves into public_guidance used the right boundary. Keep the frozen definitions used by the reviewed run visible throughout review: primary purpose, inclusion checklist, exclusions, examples and contrasts with adjacent types. Distinguish actions/precautions/procedures/requirements from purely descriptive material, without broadening the current taxonomy silently. Show newly moved arrivals in a previously reviewed folder, and require renewed confirmation for items affected by a definition change. New folders remain proposed categories until their meaning/exclusions are explicitly defined and activated; creating a folder does not change either model. Give ambiguity a first-class review state rather than treating it as correct/wrong or forcing a folder. Include the relevant definition snapshot with portable review context so users do not need Health JSON or chat instructions to understand categories. Do not automatically move/relabel files based on this checklist.


## Usable feedback milestone (2026-09-24; supersedes earlier sequencing)

Owner approved versioned definition activation and the website editor ahead of policy comparisons now that the personally corrected corpus exists. Human labels are authoritative; agent suggestions are advisory, not an adjudication gate. A1-A4 and the prescribed policy comparisons remain after this milestone. GEPA remains deferred; hooks remain disabled.

- [x] Implement immutable definition drafts, explicit stale-safe activation, editor allowlist and frozen run revisions; local D1/API checks passed.
- [x] Implement revision-specific thresholds and separate display names from model-facing category names.
- [x] Implement explicit either-A-or-B labels and immutable confirmed reference sets, excluded from misfile denominators.
- [x] Implement fingerprint-linked comparison of moved-target matches and previously-filed stability, with missing/new/ambiguous/excluded/failed counts.
- [x] Implement nonclosing result handoff and retrieval of saved correction metadata.
- [ ] Complete and release the connected website workflow and accessible visual redesign; browser checks are separate from owner acceptance.
- [ ] Exercise the deployed website through a second linked run; record actual counts. Synthetic local results do not establish model improvement.
- [ ] Complete uncoached usability and remaining fresh-account/unauthorized-user acceptance.

Reader evidence inspection also identified formatting-only rejections. New runs explicitly select whitespace-quotes-v1 while historical missing-field packs remain exact-substring-v1. Stored quotes stay unchanged; no fuzzy matching or word repair. Local replay evidence does not rewrite previous failures or claim a fresh live result.


Owner frontend feedback (2026-09-24, explicitly deferred): no visible progress bar/activity; polling appears to refresh whole page while numbers stay unchanged; globally sharp borders; harsh/glary colours despite AAcontrast; generic typography/tabs; insufficient smoothness. Next iteration must update in place, distinguish progress-known versus ongoing activity, soften surfaces/borders/accents while retaining readable AA text, and improve typography/navigation. Owner immediately said to do this later; no frontend changes or deployment authorized during current run. Active run monitoring continues.
