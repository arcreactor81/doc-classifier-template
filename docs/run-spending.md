# Spending for each run

Before uploading, choose one or more positive USD limits:

- Blended: OpenAI and TypeSafe combined.
- OpenAI: reader and outline-recovery calls.
- TypeSafe: Jev calls.

An empty category has no separate limit. Any configured limit can stop further calls. All-empty inputs are not permission for unlimited spending: select the explicit no-limit option and acknowledge its alert. Your signed-in identity, decision and confirmation time are recorded for the run. Retrying failed documents starts a new run and asks again.

The app records usage returned by each vendor API and converts it with the run's verified pricing, including retries. It displays the known combined and vendor subtotals. Missing usage is flagged, never treated as free. This is model usage for this run, not your full vendor invoice or Cloudflare infrastructure bill.

Limits stop new calls when recorded spending reaches them. They cannot cancel charges already incurred, and they are not guaranteed maximum bills. Parallel calls can be in flight together. Batch costs may arrive after many requests have completed; the submitted work can exceed a threshold before the app sees its usage. Cancellation does not erase completed work.

The app no longer requires a pre-run cost prediction. The confidence check receives full extracted text and structure without a local token counter. Actual token counts arrive with vendor responses.


## Unresolved charges and isolated failures

New runs explicitly record `isolate-unlimited-v1` as their unknown-spend policy. If a vendor request has no verified cost in a run whose owner acknowledged unlimited spending, that document receives a processing-failure outcome. The failed/unknown-cost attempt is not retried automatically. Other documents may continue. The known spend subtotal and number of unresolved charges remain visible, including after classification completes; unknown is never converted to zero or a final invoice total.

For runs with any spending limit, an unresolved charge stops admission of new requests because compliance with the recorded limit cannot be established. Completed work and retained responses stay saved. Further work requires an explicit new spending decision; existing halted runs are not automatically restarted or rewritten. In-flight work is still accounted when its response arrives.

This exception does not bypass the kill switch, disabled model calls, credential failures, model-identity checks, or inability to retain evidence. Historical runs without the new policy keep their recorded halt-on-unknown behavior. This policy changes admission and failure isolation, not category decisions or reported usage arithmetic.
