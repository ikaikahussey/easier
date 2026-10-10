import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Llm, LlmRequest } from "./llm";

/** Structured output via a single forced tool call whose input schema is the task schema. */
export class AnthropicLlm implements Llm {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async generate<T>({ system, prompt, schema }: LlmRequest<T>): Promise<T> {
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
    if (inputSchema.type !== "object") throw new Error("AI task schemas must be objects");
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: "submit_result",
          description: "Submit the completed result.",
          input_schema: inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "submit_result" },
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("Model returned no structured result");
    return schema.parse(block.input);
  }
}

export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): Llm | undefined {
  if (!env.ANTHROPIC_API_KEY) return undefined;
  return new AnthropicLlm(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
}
