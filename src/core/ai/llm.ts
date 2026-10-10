import { createHash } from "node:crypto";
import type { z } from "zod";

export interface LlmRequest<T> {
  system: string;
  prompt: string;
  /** Must be an object schema; the model returns a value conforming to it. */
  schema: z.ZodType<T>;
}

export interface Llm {
  readonly model: string;
  generate<T>(req: LlmRequest<T>): Promise<T>;
}

/**
 * A unit of AI work with a deterministic fallback. The fallback keeps the pipeline
 * usable without an API key and gives tests a stable baseline.
 */
export interface AiTask<I, O> {
  id: string;
  /** Bump when the prompt changes so cached outputs are not reused. */
  version: number;
  system: string;
  prompt: (input: I) => string;
  schema: z.ZodType<O>;
  fallback: (input: I) => O;
}

export interface AiRun {
  task: string;
  version: number;
  inputHash: string;
  model: string;
  output: unknown;
  error?: string;
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export const hashInput = (v: unknown) => createHash("sha256").update(stableStringify(v)).digest("hex").slice(0, 16);

/**
 * Runs AI tasks, reusing outputs from a previous draft when the input is unchanged.
 * Rebuilding a draft after a reviewer edit therefore costs no model calls unless
 * the edit changes a task's input.
 */
export class AiRunner {
  readonly runs: AiRun[] = [];
  private readonly prior: Map<string, AiRun>;

  constructor(
    private readonly llm: Llm | undefined,
    prior: AiRun[] = [],
  ) {
    this.prior = new Map(prior.filter((r) => !r.error).map((r) => [`${r.task}@${r.version}:${r.inputHash}`, r]));
  }

  async run<I, O>(task: AiTask<I, O>, input: I): Promise<O> {
    const inputHash = hashInput(input);
    const cached = this.prior.get(`${task.id}@${task.version}:${inputHash}`);
    if (cached) {
      const parsed = task.schema.safeParse(cached.output);
      if (parsed.success) {
        this.runs.push(cached);
        return parsed.data;
      }
    }
    const base = { task: task.id, version: task.version, inputHash };
    if (!this.llm) {
      const output = task.fallback(input);
      this.runs.push({ ...base, model: "fallback", output });
      return output;
    }
    try {
      const output = await this.llm.generate({ system: task.system, prompt: task.prompt(input), schema: task.schema });
      this.runs.push({ ...base, model: this.llm.model, output });
      return output;
    } catch (e) {
      const output = task.fallback(input);
      this.runs.push({ ...base, model: "fallback", output, error: (e as Error).message });
      return output;
    }
  }
}
