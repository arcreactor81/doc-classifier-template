# Deployment maintenance

For independent owners use the [browser walkthrough](browser-deployment.md). The root wrangler.jsonc is the portable configuration. wrangler.template.jsonc is its initial reference; Cloudflare writes owner-specific resource identities into each clone. Source code remains generic.

## Build and deploy contract

Cloudflare Workers Builds uses Node from .node-version, build command npm run build (equivalent to npm run check) and deploy command npm run deploy. The deploy command repeats the gate, applies remote D1 migrations through binding DB, then publishes the Worker with the source commit recorded. Failed checks or migrations stop publication.

Cloudflare's Deploy-button service provisions resources before its custom deployment command. The script does not try to treat placeholder resource IDs as real resources. Plain CLI deployment of an unprovisioned clone is not an alternative first-run setup.

The source must be committed. Only uncommitted platform edits to resource names and identities in wrangler.jsonc are allowed. Changes to code, bindings, model activation, project settings or authentication require a commit. First-deployment configuration rewriting and service prerequisites need a real new-account acceptance walkthrough; dry-run packaging does not verify those operations.

The public template keeps calls disabled, workers.dev enabled and preview URLs disabled. Secrets Store placeholders follow Cloudflare's documented Deploy-button schema. They are not real account IDs. Worker string secrets are not interchangeable with this runtime's Secrets Store bindings.

## Release verification

Before claiming the browser path works, use a fresh account to verify secure key prompts, independent resource creation, migrations, the Workflow binding, workers.dev routing, Access sign-in/denial and all Health blockers. No automatic activation of model calls is part of this test. The repository must be public for other owners to use its Deploy button; changing visibility is a separate owner-authorized release action.

## Current classification readiness

Local tokenizers are not required. A project must explicitly select untrimmed-structured-state-v2 and supply valid definitions, model configuration and verified pricing. Usage counts arrive in vendor responses. The website records spending limits or an acknowledged unlimited choice for each run; activation remains separate. Full source-text-containing state is deleted on user closure. Live validation of the changed confidence input and fresh-account deployment acceptance remain outstanding.

## Runtime language review

Reviewed 2026-09-22: Cloudflare announced [Python Workers general availability](https://blog.cloudflare.com/python-workers-ga/) on 2026-09-21. The project retains TypeScript because no required capability needs Python, and extraction must continue in the browser with originals kept on the user's machine. General availability alone is not a reason to migrate the existing Worker or browser implementation.
