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
