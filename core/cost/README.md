# Current monitored run spending

The active pipeline uses run-budget.ts: each run records blended/OpenAI/TypeSafe limits or explicit unlimited acknowledgement. Spending comes from validated response usage via actualUsageCost; any reached limit stops new calls, while outstanding charges may exceed it. Unknown usage is not zero. The estimateRunCost, authorizeBudget and checkLiveBudget APIs described below are legacy helpers, not the current run-creation gate; their strict-above ceiling semantics do not replace the active at-or-above monitored stop rule.

## Historical helper reference

﻿
# Cost policy

`estimateRunCost` requires document input counts including prompts/taxonomy, maximum output caps, explicit per-role prices and an explicit attempt policy. Missing recovery is an error; `null` records that recovery is unnecessary. Prices are integer nanodollars per million tokens; optional long-context input/output multipliers use exact rational integers. Tier selection compares full input strictly above the configured breakpoint and reprices the full input and output. No vendor prices, discounts, context tiers or account assumptions are embedded in code.

Arithmetic uses BigInt, rounds each billed input/output component upward to a nanodollar, then multiplies by all allowed attempts. Confidence and recovery attempts are independent; reader transport attempts multiply schema attempts. Initial execution policy 3/3/(3×2) therefore budgets three confidence calls, three recovery calls where needed, and six reader calls. The caller must use the same enforced attempt policy as execution. Outputs store monetary values as decimal strings.

The separate estimate budgets one attempt. Without measurements it uses output caps and returns `one_attempt_output_caps`; this is an upper estimate for a successful single attempt, not a predicted output size or duration. Explicit measured expected outputs can replace caps only in the estimate and are labelled accordingly. They never reduce the ceiling.

`authorizeBudget` produces the complete audit record to persist before upload/execution. Ceiling equality is allowed; excess is refused without explicit override. Override records actor/time and `limitNanodollars: null`, removing the run spending limit. `checkLiveBudget` halts refused runs and limited runs strictly above their limit. Kill-switch enforcement remains independently mandatory in every execution step.

## Explicit no-cache spending policy

On 2026-09-22 the owner-directed review chose validated ordinary token spending over cache discounts. The official [Responses create reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) documents `prompt_cache_options.mode: "explicit"` as disabling the implicit breakpoint on GPT-5.6+. The [prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) says explicit-only mode checks explicit breakpoints and charges ordinary input rates after the last selected breakpoint. Reader/recovery requests therefore set explicit mode and supply **no** explicit breakpoint markers. Consequently there is no selected cache prefix, without changing model-visible text, taxonomy, evidence or reasoning settings. Batch uses the exact same body. No undocumented mode="disabled" parameter is invented.

`actualUsageCost(usage, rates, cachePolicy)` computes returned input/output usage with exact long-context pricing. Use cachePolicy="disabled" for reader/recovery and "not_applicable" for confidence. Disabled mode requires explicit input_tokens_details.cached_tokens=0 and cache_write_tokens=0. Missing counters or nonzero caching are blockers (`E_CACHE_POLICY`); retain the full raw usage and a null-cost audit row, show spend as unaccounted, and reconcile rather than treating it as zero. This detects any vendor behavior inconsistent with the chosen request policy. The ceiling retains ordinary input rates because no cache write premium is requested. Changing this policy requires updating both ceiling and actual accounting before any run.
