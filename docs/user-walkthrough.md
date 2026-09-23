# Use the document classifier

Open your team's website in desktop Chrome or Edge and sign in. You do not need to install an app. Your administrator sets up the website and document types once; ordinary runs use the controls below.

## 1. Choose your documents

On **Home**, select **Choose source folder** and allow the browser to read it. Supported formats are PDF, Word (.docx), and PowerPoint (.pptx). Older .doc/.ppt files and scanned PDFs without a text layer cannot be processed.

Wait for local extraction to finish. Review any failures shown. Original files stay on your machine; choosing a folder does not upload them. Keep the originals for building your result folders later.

## 2. Set spending limits and start

Choose **Interactive** or **Batch**. The website suggests a mode based on the project's settings. Batch results may take up to 24 hours.

Under **Spending limits for this run**, enter at least one USD limit:

- **Blended** limits the combined recorded model spending.
- **OpenAI** and **TypeSafe** set separate vendor limits.
- A blank category has no separate limit. Leaving every field blank does not authorize unlimited spending.

To run without limits, explicitly select that option and acknowledge its warning. Recorded limits stop new requests, but already submitted work can still add charges.

Select **Review run**, then **Confirm and start run**. Changing the run mode requires another review. Text and structure are uploaded only after confirmation; originals are never uploaded. Preparation and upload progress appear while this action is working.

If the buttons are unavailable, open **Health** and share its listed setup issue with your administrator. An unavailable duration estimate is not a prediction that the run cannot finish.

## 3. Read the results

Open **Runs** and select your run. The page shows completed-document counts and recorded spending. A provider-requested pause is shown when one is active.

- **Filed**: the rules accepted the agreement for that type.
- **Review**: a person needs to decide. **Review first** marks disagreements given priority.
- **Could not process**: read the recorded reason. A completed run can contain failures; completion does not mean every document was filed.

Expand **View recorded evidence** beside a document to see the saved opinions and exact reader quotes. Missing validated output is shown explicitly. Evidence does not download a results file or close the run.

**Halt all runs** stops subsequent work across the deployment, not just the displayed run. Ask your administrator before using it unless that is what you intend.

## 4. Download the results file and build folders

When every document has an outcome, select **Download results file and close run**. Save the JSON file. This also closes the run and removes its uploaded text/outline/full document state. Decisions, vendor outputs and the results file remain. You can then work with your local originals.

Open **Build folders**:

1. Choose the saved **results file** from the completed run. It contains the destinations and decisions; it is not an original document.
2. Choose the **source folder** you used for the run. The app reads those originals locally to make copies.
3. Choose a **destination folder**, preferably a new empty folder for this run, and allow writing. This is where the app creates category folders and copies; do not select your original source folder.
4. Enter the destination's full path so path lengths can be checked. Leave the advanced filename/path-limit defaults unchanged unless a path warning asks for shorter names.
5. Select **Build folders**.

The builder copies files; it does not move your originals or overwrite conflicting destination files. Review its summary. Missing files and conflicts are listed. Repeating the build checks existing copies and resumes safely. Review/failure folders include explanatory Markdown sidecars.

## 5. Return your corrections

Inspect the built tree and move documents into the appropriate type folders. Keep filename tags when possible. Create a new folder only if you want to propose a new type; the website will ask whether it should be proposed or ignored.

Open **Corrections**, choose the same **results file**, then choose **Choose corrected output folder**. Select the whole output folder containing every category folder, not an individual category. Mark only the folders you actually checked and select **Review corrections**. Changing the selected run or results file requires choosing the tree again.

Read the move summary and proposed changes. **Download proposals JSON** saves suggestions for your administrator's Git review; it does not apply them. Retained reader quotes are partial evidence, so consult the originals. A threshold proposal, when supported by enough checked examples, has its own explicit **Apply this threshold** button. Definitions and examples do not change automatically.

## If something stops

Read the specific headline and action first; **Technical details** preserves the recorded information for your administrator. To continue an interrupted upload in the same browser profile, use **Resume confirmed upload**. For documents that finished with failures, **Retry failed documents in a new run** asks you to select their originals and confirm a new budget; it is never automatic.

**Close run and delete uploaded text** is for deliberately closing a run, including one you are abandoning. Keep the originals. Do not close an unfinished run if you still want it to continue processing.

Outline notes remain visible. With the full-text policy, missing or recovered headings alone do not require review; automatic filing still requires both systems to agree at or above the certainty threshold. Other notes and processing failures retain their review or failure outcome. Earlier runs keep their recorded policy and results.


When the correction summary says no automatically filed documents were checked, the denominator is zero because none of the checked items had been automatically filed. A move from human review to a category still records useful feedback; it does not establish automatic-filing accuracy. Only mark a folder checked after reviewing all documents in it.
