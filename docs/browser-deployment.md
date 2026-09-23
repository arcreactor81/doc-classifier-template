# Deploy your own copy in the browser

Each owner gets a separate repository, Worker, database, bucket and vendor keys. No local installation, terminal or custom domain is required. Cloudflare supplies the workers.dev address.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/arcreactor81/doc-classifier-template)

The source template is public. A fresh-copy deployment has passed resource provisioning, build and deployment checks, and unsigned production API requests remain locked. Live sign-in and unauthorized-user checks are still pending; this is not yet a completed fresh-account walkthrough.

## Before starting

The person deploying needs a GitHub or GitLab account, a Cloudflare account with Workers Paid and the required storage services enabled, and their own OpenAI and TypeSafe API keys. People who only use the resulting website need Chrome or Edge and permission to sign in; they do not install the GitHub app or development tools. Approve the account's Cloudflare billing requirements in its dashboard. Cloudflare infrastructure charges are separate from the application's model-spending limits.

Enable Zero Trust in your Cloudflare account. You will choose who may use this app through Cloudflare after its Worker exists. Protect only the new Worker in an existing account so unrelated applications keep their current settings.

## Deploy

1. Click the button and authorize Cloudflare to create your repository and build your Worker.
2. Choose the repository and Worker names. Keep the proposed database and bucket separate from other applications. Enter both keys only in Cloudflare's secure secret fields.
3. New copies do not ask for an Access audience or team hostname. Keep MODEL_CALLS_ENABLED false. Keep PROJECT_ID generic. Accept the detected build and deploy commands: npm run build and npm run deploy. The build command runs the full check gate; npm run check is equivalent. Cloudflare runs the tools remotely.
4. Wait for the build log to confirm tests, D1 migrations and deployment. Open the assigned workers.dev URL. If sign-in is not configured, the app shows a setup screen; document operations remain locked.

The template declares D1, R2 and Secrets Store bindings for the setup service. The Workflow is deployed from its exported class. No original document is involved in provisioning. The deployment script addresses migrations by the DB binding so a renamed database still works.

## Enable sign-in

**The deployment checkbox is not the final check.** In the verified fresh-copy deployment, **Protect with Cloudflare Access** created protection for preview URLs only. Preview protection does not protect the production address you give people. Check the Worker's Access settings and select **All traffic**, even if you selected the checkbox during deployment.

1. On the app's setup screen, choose **Enable sign-in**. This opens Cloudflare in a new tab.
2. Under **Workers & Pages**, select the Worker you just deployed, then open **Access**.
3. Choose **Protect this Worker behind Access** (or manage its existing protection), select **All traffic**, choose the people allowed to sign in, and select **Apply Access**. Use an existing restricted policy or configure one for the intended people; detailed rules are available in Zero Trust. This protects the supplied workers.dev address without buying a domain.
4. Return to the app and choose **Check sign-in**. The page reloads so Cloudflare can ask you to sign in.

No audience identifier, team hostname, API token, source edit or redeployment is needed to connect sign-in in a new copy. The app uses the authenticated identity supplied by Cloudflare. If production **All traffic** protection is already enabled, sign in and continue. The setup card is shown when the app has no authenticated identity; preview-only protection leaves the production app on that card.

Verify the production workers.dev address in a signed-out browser: it must ask for sign-in, and an unauthorized account must be denied. An allowed person should reach the workspace and open **Runs** without an authentication error. **Health** may still show **NOT READY** for missing document types or disabled model calls; these are separate setup steps. Missing sign-in, missing user identity or an identity lookup failure keeps document operations locked. Seeing the setup page is not proof that authentication is configured.

### Existing installations

Existing installations with explicit authentication settings retain their current JWT validation. Their settings do not need to be removed or changed to use this release. The new-copy flow serves the UI directly from the Worker so Cloudflare's authenticated request context reaches the app; it does not add account-management credentials to the application.

## Finish setup, then activate

Open /health. Resolve its numbered blockers: project definitions, model configuration, verified pricing and the explicit full structured-state policy. The generic pack deliberately contains no invented taxonomy or spending authorization. A coding harness is optional for editing the project pack; GitHub's web editor can commit changes.

Supplying keys does not activate inference. While calls are disabled, Health intentionally remains NOT READY. Once its only remaining blocker is E_MODEL_CALLS_DISABLED, and the deployment owner approves activation, change MODEL_CALLS_ENABLED to true in the repository and commit. Wait for the build to finish, then confirm /health reports READY. Do not interpret a successful deployment as successful model validation. The current release does not require a local tokenizer.

## Updates and troubleshooting

Commit changes through your repository; Workers Builds redeploys the committed revision. Never paste keys into source, screenshots or issue reports. Rotate keys through Cloudflare Secrets Store.

If setup stops before creating resources, check Cloudflare service/billing permissions in its dashboard. If migrations fail, leave inference disabled and inspect the build log. If Health reports an unexpected binding or secret, repair that binding rather than replacing a vendor or weakening validation.

Cloudflare documents the [Deploy button](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [Worker Access controls](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [Workflow deployment](https://developers.cloudflare.com/workflows/get-started/guide/) and [build image version selection](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/). Checked 2026-09-23. The button does not promise automatic Access policy creation; the guided dashboard step remains necessary when protection was not created during deployment. Cloudflare documents the [authenticated request context and its Static Assets limitation](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#read-authenticated-user-identity-with-ctxaccess).

At each run, choose USD limits for both vendors combined, OpenAI, TypeSafe, or any combination. Running without limits requires an explicit warning acknowledgement. This choice needs no Git edit. Costs are recorded from returned usage; outstanding calls and submitted Batch work may exceed the limit before accounting arrives.

## Deployment verification and remaining acceptance

Verified on a fresh copy on 2026-09-23: a new repository, separate D1/R2, both Secrets Store bindings, Workflow provisioning, migrations and deployment succeeded; the public setup page loaded and unsigned Runs requests returned 401. No model calls were made. Production Access in that attempt was still preview-only, so authenticated acceptance is not yet claimed.

For another installation, use a new repository and independent resources. Confirm the setup creates D1, R2 and both Secrets Store bindings, records the provisioned names/IDs in the clone, and completes migrations before deployment. Confirm the Workflow appears with the deployed class. The build gate deliberately rejects uncommitted application changes; resource identity rewrites alone are allowed. New copies derive an installation-specific Workflow name from the configured Worker name and binding. Existing custom names are preserved. Keep installation configuration when updating application code; do not replace an existing Workflow name with the new-install marker.

After enabling sign-in, check denial for unauthorized people and a successful signed-in Runs request without an authentication-settings commit. A login page or visible website alone does not verify that the app received a trusted identity. Then define the project types in projects/generic/project.json through the web editor, finish Health setup, and explicitly activate. These browser checks remain unverified on a fresh account; passing repository tests does not replace them.


The deployment API token must have the permissions needed for Workers and its storage bindings/migrations, including Account Secrets Store Edit. Both bound secrets must include the workers scope. A successful GitHub test run alone does not establish that Cloudflare deployment succeeded; verify the Workers Builds deployment log and the deployed Health page.
