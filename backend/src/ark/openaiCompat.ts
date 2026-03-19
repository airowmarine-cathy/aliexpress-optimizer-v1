import { getEnv } from "../env.js";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type ChatCompletionResult = {
  content: string;
  jsonMode: "native" | "fallback_parse";
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

  const doFetch = async (payload: any) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 60_000);
    try {
      return await fetch(`${ARK_BASE_URL}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${env.ARK_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  const basePayload = {
    model: args.model,
    messages: args.messages,
    temperature: args.temperature ?? 0.2,
    max_tokens: args.max_tokens
  } as any;

  // Some Ark models do NOT support response_format=json_object.
  // We try once with it (when requested) and gracefully retry without it on validation errors.
  const firstPayload = args.response_format ? { ...basePayload, response_format: args.response_format } : basePayload;
  let res = await doFetch(firstPayload);

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg0 = json?.error?.message || json?.message || text || `HTTP ${res.status}`;

    // Retry once without response_format when provider rejects it.
    const maybeNotSupported =
      args.response_format &&
      res.status === 400 &&
      (msg0.includes("response_format") || msg0.includes("json_object")) &&
      (msg0.includes("not supported") || msg0.includes("not valid") || msg0.includes("invalid"));

    if (maybeNotSupported) {
      res = await doFetch(basePayload);
      const text2 = await res.text();
      let json2: any = null;
      try {
        json2 = text2 ? JSON.parse(text2) : null;
      } catch {
        // ignore
      }
      if (!res.ok) {
        const msg2 = json2?.error?.message || json2?.message || text2 || `HTTP ${res.status}`;
        const err2: any = new Error(msg2);
        err2.status = res.status;
        err2.body = json2 ?? text2;
        throw err2;
      }
      const content2 = json2?.choices?.[0]?.message?.content ?? "";
      const usage2 = json2?.usage;
      return { content: content2, usage: usage2, jsonMode: "fallback_parse" } as ChatCompletionResult;
    }

    const err: any = new Error(msg0);
    err.status = res.status;
    err.body = json ?? text;
    throw err;
  }

  const content = json?.choices?.[0]?.message?.content ?? "";
  const usage = json?.usage;
  return { content, usage, jsonMode: "native" } as ChatCompletionResult;
}

export function extractJsonObject(text: string): any {
  const clean = String(text || "").replace(/```json\s*|\s*```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model output");
  return JSON.parse(match[0]);
}

