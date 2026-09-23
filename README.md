# Document classifier

A generic document classification system. Chrome or Edge extracts originals locally. The cloud receives text and outline, runs an independent confidence check and reader, and applies deterministic filing rules. The system produces a results file describing where each document belongs; the browser uses it to build folders from the user's originals. Human corrections are folder moves and produce proposals, never automatic taxonomy changes.

Read [DESIGN.md](DESIGN.md) before changing behavior and [HANDOFF.md](HANDOFF.md) for verified facts, implementation decisions and open issues. [AGENTS.md](AGENTS.md) defines repository rules. Project-specific definitions belong in projects/<name>/.

## Current status

The generic project is intentionally unconfigured. An empty taxonomy or disabled model calls must produce NOT READY. Local tokenizers are not required; actual usage comes from vendor responses. Each run asks for its own spending limits or explicit acknowledgement of unlimited spending. Test success does not mean the system is ready for live classification.

## Planned UI/UX improvements

The current interface needs a more polished visual design and clearer explanations for people without a technical background. Functional checks alone do not establish that the experience is intuitive or meets the intended design standard.

Design references to revisit include **Dippa Inhouse** (the reference supplied by the owner) and the **Astra launch site**. The desired direction is dynamic, lively, visually pleasing, cohesive and performant. These are references to study during the enhancement phase, not a claim that their design has already been adopted.

- Improve typography, spacing, visual hierarchy, responsive layouts and purposeful motion while preserving light/dark modes, reduced-motion support and clear outcome colours.
- Explain what each step does, why it asks for a file or folder, where documents and results go, and what the user should do next.
- Replace or explain technical terms in the main workflow. **"Manifest JSON" is a concrete example of wording many end users will not understand.** Explore plain labels such as "results file", with implementation details available only when useful.
- Place progress, success and error feedback directly below the action that triggered it, in the user's reading order. Submission feedback should remain next to its button rather than appearing above the form.
- Reduce avoidable handoffs and make the journey understandable without outside coaching. Validate the revised experience with nontechnical users, using real progress and measured performance.

**Sequence:** complete native-browser and independent-deployment acceptance first, then revisit the visual design and language as part of product enhancements. GEPA and other enhancement ideas remain separate follow-up work. This roadmap entry does not change classification behavior.

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

**After deployment, check production sign-in:** the setup form's **Protect with Cloudflare Access** checkbox may protect preview URLs only. Open **Workers & Pages ? your Worker ? Access**, select **All traffic**, and apply an allow policy for the intended people. Then return to the app and choose **Check sign-in**. No AUD, team hostname or code change is required. See the [sign-in walkthrough](docs/browser-deployment.md#enable-sign-in).

Deployment success is separate from classification readiness. The generic project requires your definitions, verified prices and the explicit full structured-state policy; /health lists blockers. Fresh-copy provisioning and locked production APIs have been verified. Live signed-in and unauthorized-user acceptance remain to be completed; a fresh-account walkthrough is not yet claimed. [Deployment maintenance](docs/deployment.md) describes build gates and release checks.

## Structure

- core/config: validated project packs and type identity.
- core/extraction and core/local: browser parsers, workers and resumable local state.
- core/digest: full structured-state construction, historical digest support and verbatim heading verification.
- core/vendors: request construction, strict response validation and bounded transports.
- core/domain: the filing rule table.
- core/cost: integer spending arithmetic and audited overrides.
- core/server and migrations: Worker API, document Workflow and durable records.
- core/builder: browser copies driven by the results file, with review notes.
- core/correction: move comparison and human-approved proposals.
- ui/app: application; ui/reference: visual reference only.
- projects/generic: initial project pack, awaiting owner configuration.

The nontechnical guide is available through Help and /How%20It%20Works.html in the app.

Spending limits are selected for each run in the website: combined, OpenAI, TypeSafe, or a combination. Running without limits requires an explicit warning acknowledgement. In-flight calls and submitted batches can exceed a monitored threshold before usage arrives. See [run spending](docs/run-spending.md).
