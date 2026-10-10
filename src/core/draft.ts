import { AiRunner, type AiRun, type Llm } from "./ai/llm";
import { runRules } from "./rules";
import type { BuildInput, DraftSnapshot, ProductDefinition } from "./product";

/** Product-agnostic draft pipeline: build → check → render. */
export async function buildDraft<I, D>(
  product: ProductDefinition<I, D>,
  input: BuildInput<I>,
  opts: { llm?: Llm; priorAi?: AiRun[] } = {},
): Promise<DraftSnapshot<D>> {
  const ai = new AiRunner(opts.llm, opts.priorAi);
  const { data, editable } = await product.build(input, ai);
  const findings = runRules(product.rules, { input, data });
  for (const run of ai.runs.filter((r) => r.error))
    findings.push({
      ruleId: "ai.unavailable",
      severity: "warning",
      message: `AI task "${run.task}" failed (${run.error}); deterministic fallback used`,
    });
  return { data, editable, findings, sections: product.render(data, input), ai: ai.runs };
}
