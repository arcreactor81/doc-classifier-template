# Document classifier

A generic document classification system. Chrome or Edge extracts originals locally. The cloud receives text and outline, runs an independent confidence check and reader, and applies deterministic filing rules. The deliverable is a manifest; the browser builds folders from the user's originals. Human corrections are folder moves and produce proposals, never automatic taxonomy changes.

Read [DESIGN.md](DESIGN.md) before changing behavior and [HANDOFF.md](HANDOFF.md) for verified facts, implementation decisions and open issues. [AGENTS.md](AGENTS.md) defines repository rules. Project-specific definitions belong in projects/<name>/.

## Current status

The generic project is intentionally unconfigured. An empty taxonomy or disabled model calls must produce NOT READY. Local tokenizers are not required; actual usage comes from vendor responses. Each run asks for its own spending limits or explicit acknowledgement of unlimited spending. Test success does not mean the system is ready for live classification. No paid model inference has been used to validate the implementation.

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

Follow the [browser-only setup](docs/browser-deployment.md) to create your own copy on a Cloudflare workers.dev address. No custom domain or local installation is required. Cloudflare provisions storage and prompts for your keys; protect the Worker through its Access dashboard. Model calls start disabled.

Deployment success is separate from classification readiness. The generic project requires your definitions, verified prices and the explicit full structured-state policy; /health lists blockers. The fresh-account button walkthrough has not yet been acceptance-tested. [Deployment maintenance](docs/deployment.md) describes build gates and release checks.

## Structure

- core/config: validated project packs and type identity.
- core/extraction and core/local: browser parsers, workers and resumable local state.
- core/digest: full structured-state construction, historical digest support and verbatim heading verification.
- core/vendors: request construction, strict response validation and bounded transports.
- core/domain: the filing rule table.
- core/cost: integer spending arithmetic and audited overrides.
- core/server and migrations: Worker API, document Workflow and durable records.
- core/builder: manifest-driven browser copies and review sidecars.
- core/correction: move comparison and human-approved proposals.
- ui/app: application; ui/reference: visual reference only.
- projects/generic: initial project pack, awaiting owner configuration.

The nontechnical guide is available through Help and /How%20It%20Works.html in the app.

Spending limits are selected for each run in the website: combined, OpenAI, TypeSafe, or a combination. Running without limits requires an explicit warning acknowledgement. In-flight calls and submitted batches can exceed a monitored threshold before usage arrives. See [run spending](docs/run-spending.md).
