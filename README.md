# Document classifier

A generic document classification system. Chrome or Edge extracts originals locally. The cloud receives text and outline, runs an independent confidence check and reader, and applies deterministic filing rules. The system produces a results file describing where each document belongs; the browser uses it to build folders from the user's originals. Human corrections are folder moves and produce proposals, never automatic taxonomy changes.

Read [DESIGN.md](DESIGN.md) before changing behavior and [HANDOFF.md](HANDOFF.md) for verified facts, implementation decisions and open issues. [AGENTS.md](AGENTS.md) defines repository rules. Application code and deployment settings remain in the repository. Website-managed category versions are stored separately and frozen into each run; project packs remain the seed or explicitly selected legacy configuration.

## Current status

The current implementation candidate connects category editing, explicit activation, corrections and a fingerprint-linked next run. Local tests exercise immutable versions, editor permissions, threshold transfer and comparison counts. **The complete deployed browser sequence and unassisted usability acceptance are still pending.** Passing tests or deploying a website is not proof that the full user task is complete.

The generic project begins without invented categories or spending approval. Its deployment owner enables sign-in and explicitly names category editors once. An editor then creates the categories on the website. Empty definitions or disabled model calls must produce **NOT READY**. Each run asks for spending limits or an explicit acknowledgement of running without a limit. Actual usage comes from vendor responses; local tokenizers are not required.

## The user workflow

1. In **Categories**, define what belongs in each category, what does not, and reviewed examples. Choose **Save for review**, then **Activate these categories**.
2. Choose local documents, confirm the spending decision and run the classifier. Originals stay on your computer.
3. Build output folders locally, review placements and move documents to the intended folders.
4. Submit the corrected tree and choose **Review category changes**. Review and explicitly activate accepted definition changes.
5. **Confirm the answers for your next run**, including any **Either category is acceptable** decisions, then start the linked comparison run.
6. Read how many moved documents now reach their intended category and how many previously automatically assigned documents remain assigned the same way. Ambiguous and excluded cases have separate counts.

Normal category editing and feedback do not require Git knowledge or an intermediate JSON download. The application's code and one-time deployment administration remain separate. See the [complete category workflow](docs/category-workflow.md) and [browser deployment guide](docs/browser-deployment.md).

## UI/UX acceptance

The UI is part of this milestone, not a later cosmetic upgrade. The implementation candidate connects the workflow, carries run context, adds category editing and comparison decisions, and reduces the need to reconstruct steps manually. These changes still need real browser and user acceptance; they are not a claim that the requested experience has been achieved.

The owner's feedback remains binding: the previous interface was too basic, jargon-heavy, spread across disconnected views, and impractical for large document lists. A user should not need chat instructions to discover the next button. "Manifest JSON" is an example of internal terminology that does not belong in the normal flow.

Visual references include **Dippa Inhouse**, the **Astra launch site**, and **TRON: Legacy**, especially loading indicators, purposeful transitions and movement between views. Acceptance requires:

- One continuous, resumable input-to-results-to-local-build-to-corrections-to-activation journey, with clear next actions.
- Visible progress, completion and errors below the action that caused them; no silent wait after upload or submission.
- A dedicated monitoring window when starting a run, while retaining the main workspace and providing a clear popup-blocked alternative.
- Compact searchable, paginated results and evidence opened on demand, rather than hundreds of expanded document cards.
- Plain-language explanations of categories, source and output folders, local versus cloud operations, and what each confirmation changes.
- AA contrast in light and dark themes, clear outcome colours, responsive layouts and reduced-motion-safe transitions. Density must not remove the explanations people need.

Preserve existing results and human decisions. Activation affects future runs, not historical placements. GEPA, historical cost estimates, observed model identity display and the remaining policy comparisons follow this milestone; they are not reasons to delay the usable feedback loop. Progress hooks remain disabled.

## Development

Use Node 24.18.0.

```text
npm ci
npm run check
npm run dev
```

The check command typechecks browser and Worker contexts separately, runs the test suite with a printed total, and builds the UI. The development UI uses port 5173 and proxies API requests to Wrangler on port 8787. Run npm run dev:api separately for the local backend. Production Secrets Store values are not copied into local development.

Browser originals remain on the user's machine. Local extraction state uses IndexedDB; selecting the source again verifies fingerprints and resumes eligible work. The builder copies files and never overwrites a conflicting destination.

## Deployment

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/arcreactor81/doc-classifier-template)

Follow the [browser-only setup](docs/browser-deployment.md) to create your own copy on a Cloudflare workers.dev address. No custom domain or local installation is required. Cloudflare provisions storage and prompts for your keys. New copies then guide you to enable sign-in and choose who may use the app through Cloudflare. You do not enter an audience identifier or team hostname. Document operations remain locked until sign-in works, and model calls start disabled. Existing installations retain their configured authentication.

**After deployment, check production sign-in:** the setup form's **Protect with Cloudflare Access** checkbox may protect preview URLs only. Open **Workers & Pages > your Worker > Access**, select **All traffic**, and apply an allow policy for the intended people. Then return to the app and choose **Check sign-in**. No AUD, team hostname or code change is required. See the [sign-in walkthrough](docs/browser-deployment.md#enable-sign-in).

Deployment success is separate from classification readiness. The generic project requires explicitly activated categories, verified prices and its selected input policy; Health lists blockers. Fresh-copy provisioning and locked production APIs have been verified. Live signed-in and unauthorized-user acceptance remain to be completed; a fresh-account walkthrough is not yet claimed. [Deployment maintenance](docs/deployment.md) describes build gates and release checks.

## Structure

- core/config: validated project packs, definition policy and type identity.
- core/extraction and core/local: browser parsers, workers and resumable local state.
- core/digest: full structured-state construction, historical digest support and verbatim heading verification.
- core/vendors: request construction, strict response validation and bounded transports.
- core/domain: the filing rule table.
- core/cost: integer spending arithmetic and audited overrides.
- core/server and migrations: Worker API, document Workflow and durable records.
- core/builder: browser copies driven by the results file, with review notes.
- core/correction: folder moves, human-confirmed reference labels and fingerprint comparisons.
- ui/app: application; ui/reference: visual reference only.
- projects/generic: initial deployment settings and category seed; runtime categories are activated on the website.

The nontechnical guide is available through Help and /How%20It%20Works.html in the app.

Spending limits are selected for each run in the website: combined, OpenAI, TypeSafe, or a combination. Running without limits requires an explicit warning acknowledgement. In-flight calls and submitted batches can exceed a monitored threshold before usage arrives. See [run spending](docs/run-spending.md).
