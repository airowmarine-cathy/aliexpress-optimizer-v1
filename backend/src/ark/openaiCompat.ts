import { getEnv } from "../env.js";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type ChatCompletionResult = {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export async function arkChatCompletion(args: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  timeoutMs?: number;
  // Ask provider to return json object if supported.
  response_format?: { type: "json_object" };
}) {
  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 60_000);
  const res = await fetch(`${ARK_BASE_URL}/chat/completions`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${env.ARK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      temperature: args.temperature ?? 0.2,
      max_tokens: args.max_tokens,
      response_format: args.response_format
    })
  }).finally(() => clearTimeout(timeout));

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text || `HTTP ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.body = json ?? text;
    throw err;
  }

  const content = json?.choices?.[0]?.message?.content ?? "";
  const usage = json?.usage;
  return { content, usage } as ChatCompletionResult;
}

export function extractJsonObject(text: string): any {
  const clean = String(text || "").replace(/```json\s*|\s*```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model output");
  return JSON.parse(match[0]);
}

