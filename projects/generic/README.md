# Generic deployment pack

This is an intentionally unconfigured pack, not a sample taxonomy. Health must remain NOT READY for live classification until type definitions, structural vocabulary, the explicit confidence-state policy and model pricing are supplied. Throughput estimates may remain explicitly unknown.

Edit project.json through Git. Each type requires id, name, what, not_for and examples. Structural terms must name document parts and cannot overlap words in type names, descriptions or examples. The loader rejects collisions.

Initial implementation settings are threshold 0.90 (stored in D1), low reader effort, and minimum 50 checked filed documents. The confidence-state policy is untrimmed-structured-state-v2: full extracted text and structure, without local token counting or trimming. Other generic extraction and output-cap choices are explicit settings rather than hidden constants.

The template selects GPT-6 Sol for the reader and GPT-5.6 Luna for outline recovery under its explicit model policy. Jev is versioned. Runtime retains the returned model identities, and historical Terra configurations remain valid.

Each run records the signed-in person's spending limits or explicit unlimited-spending acknowledgement. No project-pack budget or HANDOFF sign-off is required for that choice. Separate live validation campaigns still need their own authorization. Never enter API key values here.

Activation: commit the pack, run all tests/typecheck/build, deploy that exact Git revision using Cloudflare Workers Builds. Pin/prompt/confidence-input/reader changes require the bake-off on a real owner-corrected dataset before adoption; no numbers exist yet.

Bake-off: not run; no first labelled batch exists.

Spending limits are selected for each run in the website: combined, OpenAI, TypeSafe, or a combination. Running without limits requires an explicit warning acknowledgement. In-flight calls and submitted batches can exceed a monitored threshold before usage arrives. See [run spending](../../docs/run-spending.md).
