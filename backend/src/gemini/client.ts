import { GoogleGenAI } from "@google/genai";
import { getEnv } from "../env.js";

const env = getEnv();
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export type GeminiAttempt = {
  provider: "gemini";
  modelId: string;
  jsonMode: "native";
  inputTokens?: number;
  outputTokens?: number;
};

export async function runGeminiWithFallback<T>(args: {
  models: string[];
  systemInstruction: string;
  userContent: string;
  responseSchema?: any;
  validate: (obj: any) => T;
}): Promise<{ result: T; attempt: GeminiAttempt }> {
  let lastErr: any = null;
  for (const modelId of args.models) {
    try {
      const res = await ai.models.generateContent({
        model: modelId,
        contents: [{ text: args.userContent }],
        config: {
          systemInstruction: args.systemInstruction,
          responseMimeType: "application/json",
          responseSchema: args.responseSchema
        }
      });
      const text = String(res.text || "").replace(/```json\s*|\s*```/g, "").trim();
      const obj = JSON.parse(text);
      const result = args.validate(obj);
      const usage = (res as any).usageMetadata;
      return {
        result,
        attempt: {
          provider: "gemini",
          modelId,
          jsonMode: "native",
          inputTokens: usage?.promptTokenCount,
          outputTokens: usage?.candidatesTokenCount
        }
      };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("All Gemini models failed");
}

