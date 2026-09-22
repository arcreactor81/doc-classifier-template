# Generic deployment pack

This is an intentionally unconfigured pack, not a sample taxonomy. Health must remain NOT READY for live classification until type definitions, structural vocabulary, verified local tokenizer metadata and a signed spending limit are supplied. Throughput estimates may remain explicitly unknown.

Edit project.json through Git. Each type requires id, name, what, not_for and examples. Structural terms must name document parts and cannot overlap words in type names, descriptions or examples. The loader rejects collisions.

Initial implementation settings are threshold 0.90 (stored in D1), 6,000-token digest, low reader effort, and minimum 50 checked filed documents. Other generic extraction and output-cap choices are explicit settings rather than hidden constants.

The template uses Terra/Luna family aliases under its explicit model policy. Jev is versioned. Runtime must retain returned model identities.

Budget changes require dated written owner approval recorded in HANDOFF.md. Never enter API key values here.

Activation: commit the pack, run all tests/typecheck/build, deploy that exact Git revision using Cloudflare Workers Builds. Pin/prompt/digest/reader changes require the bake-off on a real owner-corrected dataset before adoption; no numbers exist yet.

Bake-off: not run; no first labelled batch exists.
