# Generic deployment pack

This is an intentionally unconfigured pack, not a sample taxonomy. Health must remain NOT READY for live classification until type definitions, structural vocabulary, the explicit confidence-state policy and model pricing are supplied; model calls must then be explicitly enabled.

Edit project.json through Git. Each type requires id, name, what, not_for and examples. Structural terms must name document parts and cannot overlap words in type names, descriptions or examples. The loader rejects collisions.

Initial settings are threshold 0.90 (stored in D1), low reader effort and minimum 50 checked filed documents. The current confidence-state policy is untrimmed-structured-state-v2: full extracted text and structure, without a local token counter or 6,000-token trimming. Other generic extraction and output-cap choices are explicit settings rather than hidden constants.

New runs select GPT-6 Sol as the reader and GPT-5.6 Luna for outline recovery under the owner's explicit model approvals. Jev is versioned. Runtime retains returned model identities; historical Terra configurations remain valid.

Each run records the signed-in person's limits or explicit unlimited-spending acknowledgement. No project-pack budget sign-off is required for that website choice. Separate live validation campaigns still require authorization. Never enter API key values here.

Activation: commit the pack, run all tests/typecheck/build, deploy that exact Git revision using Cloudflare Workers Builds. Pin/prompt/confidence-input/reader changes require the bake-off on a real owner-corrected dataset before adoption; no numbers exist yet.

Bake-off: not run; no first labelled batch exists.

Run spending limits are chosen in the website, not required in this pack. Unknown account throughput may be null; duration then remains unavailable. Historical budget fields are retained for audit only and never silently authorize new runs.


New runs use full-text-outline-v3: complete text once with heading/table metadata, without duplicated fragment-text records. Recovery uses owner-approved gpt-6-luna with unchanged exact-line verification and recorded prices. Old frozen v2/Luna5.6 runs remain readable and unchanged. Generic type definitions remain empty and model activation remains explicit.
