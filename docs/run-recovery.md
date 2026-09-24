# Continue saved processing after an infrastructure interruption

An interrupted run may contain completed model calls even when no documents have final results. The app can reuse those saved results instead of starting the corpus again.

On an eligible stopped run, **Continue using saved work** explains the checks. Confirm the original categories and spending settings, then choose **Continue saved processing**. This is explicit: refreshing the page never starts recovery. The app first verifies old executions have stopped, inputs remain available, all earlier charges are accounted for, and no operation has an uncertain outcome. If a check fails, the run remains preserved and the reason is shown.

Continuation stays within the same run and comparison link. Completed vendor calls and decisions are not repeated or rewritten. Unfinished documents receive new execution identities; old execution history remains available. A lost creation acknowledgement keeps its reserved identity instead of creating a replacement. The app reports scheduling progress separately from document completion.

This version supports infrastructure stops before submission of a reader Batch. It refuses already-submitted Batch work, unresolved charges, incomplete checkpoints, missing text, kill-switch stops and changed reader contracts. A refusal is not permission to rerun an uncertain vendor call.

The underlying acknowledgement repair only recovers a completed durable checkpoint after the known outer Workflow connection error. It is not a blanket retry policy. Local fault-injection and recovery-route tests validate these boundaries; real run continuation and final fingerprint comparison remain separate acceptance evidence.
