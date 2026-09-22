# Official Jev tokenizer request

Status: prepared for the owner; not sent to TypeSafe. No account identifiers, documents or credentials are included.

> We use jev-1.13.0 and need to build a deterministic extract limited to 6,000 Jev tokens locally in Chrome/Edge before sending any document text. Where can we obtain the official tokenizer implementation and versioned vocabulary/configuration assets, with permission to bundle them in a browser application? Please include any required normalization, special-token rules and example text/token-count pairs.

Sources reviewed: [API reference](https://docs.typesafe.ai/api), [model limits](https://docs.typesafe.ai/models), [documentation index](https://docs.typesafe.ai/llms.txt), and [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript). None of these documents supplies an official local tokenizer. This is a finding about the reviewed public interfaces, not proof that TypeSafe cannot provide one.

The owner has since replaced cost prediction with monitored per-run spending. The request above is solely for the unchanged local digest; no offline billing counter is needed for the revised budget feature.
