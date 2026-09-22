# Spending for each run

Before uploading, choose one or more positive USD limits:

- Blended: OpenAI and TypeSafe combined.
- OpenAI: reader and outline-recovery calls.
- TypeSafe: Jev calls.

An empty category has no separate limit. Any configured limit can stop further calls. All-empty inputs are not permission for unlimited spending: select the explicit no-limit option and acknowledge its alert. Your signed-in identity, decision and confirmation time are recorded for the run. Retrying failed documents starts a new run and asks again.

The app records usage returned by each vendor API and converts it with the run's verified pricing, including retries. It displays the known combined and vendor subtotals. Missing usage is flagged, never treated as free. This is model usage for this run, not your full vendor invoice or Cloudflare infrastructure bill.

Limits stop new calls when recorded spending reaches them. They cannot cancel charges already incurred, and they are not guaranteed maximum bills. Parallel calls can be in flight together. Batch costs may arrive after many requests have completed; the submitted work can exceed a threshold before the app sees its usage. Cancellation does not erase completed work.

The app no longer requires a pre-run cost prediction. The official Jev tokenizer remains necessary for selecting the 6,000-token digest; that is separate from spending measurement.
