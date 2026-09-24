# Categories, corrections and the next run

This guide describes the current implementation candidate. Local tests exercise its storage and API behavior; the complete deployed browser workflow and unassisted usability acceptance are still pending. A successful build is not evidence that a person has completed these steps without help.

## Before your first run

The deployment owner enables sign-in, names the people allowed to edit categories, and approves model spending. These are one-time administration tasks described in [browser deployment](browser-deployment.md#finish-setup-then-activate). Ordinary users need no development tools or repository access.

1. Open **Categories**. An authorized editor can create or edit categories; other signed-in users can read them.
2. Choose **Add a category**. For each category, provide **Category name used by both models**, **What belongs here?**, **What does not belong here?**, and **Examples - one per line**. Use examples you have reviewed against the original documents.
3. **Name shown on the website** changes the display label separately from the model-facing name. Changing only that display label preserves calibration. Changing the model-facing name, meaning, exclusions, examples, or category set changes the classification configuration.
4. Choose **Save for review**. This saves a draft; it does not change the active categories.
5. Review the complete set, then choose **Activate these categories**. Activation is explicit. If another editor activated a version first, refresh and review a new draft rather than overwriting their changes.
6. Check **Health**. New definitions are untested and start at a certainty threshold of 0.90. Model calls remain disabled until the deployment owner separately enables them.

An initial category set is never inferred from the first visitor. Nor does possession of a sign-in account automatically confer editing rights.

## Run, build and review

Choose a source folder in Chrome or Edge, review the document list and spending decision, then start the run. Originals stay on your machine; the cloud receives extracted text and document structure. Keep the originals available for the local folder build.

After the run completes, build its output folders in a separate destination outside the source folder. Review the category definitions before judging placements. Check automatically assigned folders as well as human-review documents: checking only the latter cannot measure incorrect automatic filings.

Move documents to the desired folders, preserving their identifying filename prefixes. Move rather than copy, so each document has one final location. Do not rebuild over your corrections. Leave processing failures unchanged if you have not reviewed them. A new folder proposes a category; it does not activate one.

In **Corrections**, choose the whole corrected output folder, including its category folders. Indicate only folders you actually checked. The active run's results are carried through the connected flow; importing a results file remains available for an older or separately opened workflow.

Submit the corrections. Review the decisions for new folders, distinguishing a proposed category from intentionally ignored files. Saving corrections records your feedback; it does not change model definitions or the threshold.

## Accept category changes

Choose **Review category changes** to open **Categories** with the saved correction context. If you return later, open the completed run and use **Continue saved corrections** to select the dated correction record; you do not need to repeat the folder moves. Review suggested examples against the original document; retained model quotes can be partial evidence. Adding an example or exclusion to the draft is a deliberate action, not an automatic effect of submitting a corrected tree.

Complete the meaning, exclusions and examples for new categories, choose **Save for review**, then **Activate these categories**. Both systems use that activated category version for future runs. Existing runs retain their original category definitions and decisions.

A semantic change normally starts at 0.90 again. **Keep the earlier threshold and mark it unverified** is an explicit alternative; it does not claim the old calibration is valid for changed meanings. A display-only change preserves the earlier calibration and its justification. A proposal from an older version cannot change another version's threshold.

No repository edit or intermediate download is required for this normal correction-to-activation flow. Application code and deployment administration remain separate from category editing.

## Confirm the comparison answers

After activation, use **Confirm the answers for your next run**. Folder moves supply proposed reference answers, and your confirmed decisions are authoritative. An agent's opinion is advisory.

For a document, **Your decision** can be:

- **One category**: a single confirmed answer.
- **Either category is acceptable**: choose **First acceptable category** and **Other acceptable category**. This records ambiguity without forcing a folder move. These documents are counted separately and excluded from misfile denominators.
- **Exclude from comparison**: keep the document out of the scored reference set.

Map any newly created folder to the intended activated category. Processing failures and unconfirmed cases remain visible as separate counts. Then choose **Confirm labels for comparison** and **Start a run**. Reselect the local source documents when the browser asks; comparison never requires a cloud collection of originals.

## Read the next run's comparison

The next run is linked to the confirmed corrections and category version. Documents match by their content fingerprint, not their current filename or folder. The results report:

- Of the documents you moved, how many now reach the category you selected.
- Of previously automatically assigned documents, how many are automatically assigned the same way again.
- Ambiguous, excluded, unconfirmed, missing, newly added and failed documents separately, with the applicable denominators.

A partial run is not a completed comparison. A fingerprint that has changed does not count as the same document. Seeing a second set of placements alone is not acceptance evidence: the linked counts must be present and verified.

## What is still pending

The acceptance milestone requires the deployed website sequence to be exercised, its fingerprint comparison verified, and a nontechnical user to complete it without chat coaching. Visual acceptance includes AA contrast in both themes, purposeful reduced-motion-safe movement, readable explanations and compact results rather than an endless expanded document list.

Historical cost estimates, last-observed model identity display, input/recovery/reader policy comparisons and the broader manual evaluator remain tracked after this milestone. GEPA remains deferred. No automatic replay or extra inference spending is authorized by saving corrections or activating categories.
