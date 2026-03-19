import { estimateCostCny } from "../ark/pricing.js";
import { arkChatCompletion, extractJsonObject } from "../ark/openaiCompat.js";

export type RouteAttempt = {
  provider: "ark";
  modelId: string;
  jsonMode: "native" | "fallback_parse";
  inputTokens?: number;
  outputTokens?: number;
  costCny?: number | null;
};

export async function runWithModelFallback<T>(args: {
  models: string[];
  messages: { role: "system" | "user"; content: string }[];
  responseFormatJson?: boolean;
  validate: (obj: any) => T;
  timeoutMs?: number;
}): Promise<{ result: T; attempt: RouteAttempt }> {
  let lastErr: any = null;

  for (const modelId of args.models) {
    try {
      const completion = await arkChatCompletion({
        model: modelId,
        messages: args.messages,
        timeoutMs: args.timeoutMs ?? 60_000,
        response_format: args.responseFormatJson ? { type: "json_object" } : undefined
      });

      const obj = extractJsonObject(completion.content);
      const result = args.validate(obj);

      const inputTokens = completion.usage?.prompt_tokens;
      const outputTokens = completion.usage?.completion_tokens;
      const costCny = estimateCostCny(modelId, inputTokens, outputTokens);

      return {
        result,
        attempt: {
          provider: "ark",
          modelId,
          jsonMode: completion.jsonMode,
          inputTokens,
          outputTokens,
          costCny
        }
      };
    } catch (e: any) {
      lastErr = e;
      // If rate limit/quota, try next model.
      // If parse/validation error, also try next model.
      continue;
    }
  }

  throw lastErr || new Error("All models failed");
}

