# Deploy your own copy in the browser

Each owner gets a separate repository, Worker, database, bucket and vendor keys. No local installation, terminal or custom domain is required. Cloudflare supplies the workers.dev address.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/arcreactor81/doc-classifier-template)

The source template is public. The browser deployment path is implemented, but a fresh-account walkthrough has not yet been acceptance-tested.

## Before starting

The person deploying needs a GitHub or GitLab account, a Cloudflare account with Workers Paid and the required storage services enabled, and their own OpenAI and TypeSafe API keys. People who only use the resulting website need Chrome or Edge and permission to sign in; they do not install the GitHub app or development tools. Approve the account's Cloudflare billing requirements in its dashboard. Cloudflare infrastructure charges are separate from the application's model-spending limits.

Enable Zero Trust in your Cloudflare account. For a new account used only for this app, you can protect all future Workers before deployment using Workers & Pages > Protect all Workers > All traffic and an authentication policy restricted to the intended people. For a single email address or other detailed rules, edit the created application in Zero Trust; the simple Worker dialog offers account membership or email-domain policies. In an existing account, protect only the new Worker after deployment to avoid changing unrelated applications.

## Deploy

1. Click the button and authorize Cloudflare to create your repository and build your Worker.
2. Choose the repository and Worker names. Keep the proposed database and bucket separate from other applications. Enter both keys only in Cloudflare's secure secret fields.
3. Keep MODEL_CALLS_ENABLED false. Keep PROJECT_ID generic. Accept the detected build and deploy commands: npm run build and npm run deploy. The build command runs the full check gate; npm run check is equivalent. Cloudflare runs the tools remotely.
4. Wait for the build log to confirm tests, D1 migrations and deployment. Open the assigned workers.dev URL.

The template declares D1, R2 and Secrets Store bindings for the setup service. The Workflow is deployed from its exported class. No original document is involved in provisioning. The deployment script addresses migrations by the DB binding so a renamed database still works.

## Protect this Worker and connect authentication

If you did not protect future Workers before deployment, open Workers & Pages > your Worker > Access > Protect this Worker behind Access. Choose All traffic, restrict the allow policy to the intended people, and Apply Access. This covers workers.dev; a domain purchase is unnecessary.

Open the resulting application in Zero Trust > Access > Applications. Copy its application audience (AUD) and your Zero Trust team hostname ending in .cloudflareaccess.com. In your repository's web editor, update ACCESS_AUD and ACCESS_TEAM_DOMAIN inside wrangler.jsonc, commit, then let Workers Builds redeploy. These two identifiers are not vendor keys.

Verify that a signed-out browser must sign in and an unauthorized account is denied. Missing app authentication configuration blocks data operations even during initial setup; the public setup UI alone is not proof that Access is configured.

## Finish setup, then activate

Open /health. Resolve its numbered blockers: project definitions, model configuration, verified pricing and the explicit full structured-state policy. The generic pack deliberately contains no invented taxonomy or spending authorization. A coding harness is optional for editing the project pack; GitHub's web editor can commit changes.

Supplying keys does not activate inference. While calls are disabled, Health intentionally remains NOT READY. Once its only remaining blocker is E_MODEL_CALLS_DISABLED, and the deployment owner approves activation, change MODEL_CALLS_ENABLED to true in the repository and commit. Wait for the build to finish, then confirm /health reports READY. Do not interpret a successful deployment as successful model validation. The current release does not require a local tokenizer.

## Updates and troubleshooting

Commit changes through your repository; Workers Builds redeploys the committed revision. Never paste keys into source, screenshots or issue reports. Rotate keys through Cloudflare Secrets Store.

If setup stops before creating resources, check Cloudflare service/billing permissions in its dashboard. If migrations fail, leave inference disabled and inspect the build log. If Health reports an unexpected binding or secret, repair that binding rather than replacing a vendor or weakening validation.

Cloudflare documents the [Deploy button](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [Worker Access controls](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [Workflow deployment](https://developers.cloudflare.com/workflows/get-started/guide/) and [build image version selection](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/). Checked 2026-09-22. The button does not promise automatic Access policy creation; the dashboard steps above remain necessary.

At each run, choose USD limits for both vendors combined, OpenAI, TypeSafe, or any combination. Running without limits requires an explicit warning acknowledgement. This choice needs no Git edit. Costs are recorded from returned usage; outstanding calls and submitted Batch work may exceed the limit before accounting arrives.

## Fresh-owner acceptance still to perform

Use a new repository and independent resources. Confirm the setup creates D1, R2 and both Secrets Store bindings, records the provisioned names/IDs in the clone, and completes migrations before deployment. Confirm the Workflow appears with the deployed class. The build gate deliberately rejects uncommitted application changes; resource identity rewrites alone are allowed. If deploying another copy into an account that already has this template, use distinct resource and Workflow names in Git.

After Access setup and the authentication-settings commit, check both sign-in denial for unauthorized people and a successful signed-in Runs request. A login page or visible static website alone does not verify the app's JWT audience/team settings. Then define the project types in projects/generic/project.json through the web editor, finish Health setup, and explicitly activate. These browser checks remain unverified on a fresh account; passing repository tests does not replace them.
