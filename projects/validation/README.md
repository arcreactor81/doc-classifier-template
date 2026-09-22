# Public document validation

This is a separate validation project, not the generic deployment configuration. It contains three generic document-purpose types and six public PDFs (12 pages total). The originals and inspection renders exist only under `.local/validation/`, which is ignored by Git. `corpus.json` records download URLs, permission sources, exact SHA-256 identities, sizes, page counts, label evidence and ambiguity. Do not upload original bytes or commit them.

## Frozen definitions and provisional references

The sole taxonomy source is `project.json` -> `typeFile`. `taxonomy-freeze.json` records its runtime-compatible hash and freeze timestamp before any vendor result was seen. Types are data collection form, public guidance, and statistical bulletin, plus none-of-these. Definitions and examples are generic; no source titles appear in the taxonomy. Structural terms name document parts and pass the unchanged collision validator.

Reference labels are **agent-curated provisional references, not human-corrected ground truth**. Every PDF was text-inspected and all 12 pages visually inspected locally. SF180 is deliberately retained as an ambiguous mixed form/explanation document under the frozen primary-purpose definition. The illustrated heat publication may lose visual information in text-only extraction. The two BLS summaries share a template. This is a convenience smoke corpus with source/template confounding, no none-of-these example, only PDFs, and no statistical power to establish production precision or calibration. It does not replace DESIGN section 10's human-corrected dataset or the minimum 50 automatically agreed outcomes required for threshold proposals.

| Local original | Provisional reference | Pages | Source |
|---|---|---:|---|
| opm71.pdf | data_collection_form | 1 | [OPM official PDF](https://www.opm.gov/forms/pdf_fill/opm71.pdf) |
| sf180.pdf | data_collection_form | 3 | [GSA official form](https://www.gsa.gov/reference/forms/request-pertaining-to-military-records) |
| ladder.pdf | public_guidance | 2 | [OSHA official PDF](https://www.osha.gov/sites/default/files/publications/PORTABLE_LADDER_QC.pdf) |
| heat.pdf | public_guidance | 2 | [OSHA official PDF](https://www.osha.gov/sites/default/files/publications/3422_FACTSHEET_EN.pdf) |
| phoenix.pdf | statistical_bulletin | 2 | [BLS official PDF](https://www.bls.gov/regions/west/summary/blssummary_phoenix.pdf) |
| sanfrancisco.pdf | statistical_bulletin | 2 | [BLS official PDF](https://www.bls.gov/regions/west/summary/blssummary_sanfrancisco.pdf) |

OPM/GSA forms explicitly authorize local reproduction. [DOL's copyright policy](https://www.dol.gov/general/aboutdol/copyright) covers government-authored publications, with exceptions for identified third-party material. [BLS's copyright policy](https://www.bls.gov/opub/copyright-information.htm) permits public-domain material, subject to third-party exceptions and agency emblem restrictions. No third-party copyright credit was observed in the selected PDFs. Downloads are retained unchanged locally, not republished, and no agency endorsement is implied. Sources/permissions checked 2026-09-22. BLS copies are dated September 2, 2026; their URLs are mutable, so reproduce using the recorded hash, never silently replace originals.


## Validation status and budget

This distribution grants no spending approval. Each owner must set an explicit budget before calls. The six sources have been inspected and taxonomy frozen before model results. References are agent-curated and provisional, not human-corrected ground truth. No vendor calls, accuracy metrics or bake-off results are included. Tokenizer verification and live evaluation remain outstanding. Compute an aggregate reservation for all planned runs, attempts and recovery before execution; per-run limits alone do not enforce a campaign limit.
