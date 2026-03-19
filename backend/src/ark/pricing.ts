type PriceTier = {
  maxInputTokens: number; // inclusive
  inputPerMillion: number;
  outputPerMillion: number;
};

// Prices based on your pasted Ark price table (CNY / 1,000,000 tokens).
// Source reference: https://www.volcengine.com/docs/82379/1544106?lang=zh
const PRICING: Record<string, PriceTier[]> = {
  "doubao-seed-2-0-mini": [
    { maxInputTokens: 32_000, inputPerMillion: 0.2, outputPerMillion: 2.0 },
    { maxInputTokens: 128_000, inputPerMillion: 0.4, outputPerMillion: 4.0 },
    { maxInputTokens: 256_000, inputPerMillion: 0.8, outputPerMillion: 8.0 }
  ],
  "doubao-seed-2-0-lite": [
    { maxInputTokens: 32_000, inputPerMillion: 0.6, outputPerMillion: 3.6 },
    { maxInputTokens: 128_000, inputPerMillion: 0.9, outputPerMillion: 5.4 },
    { maxInputTokens: 256_000, inputPerMillion: 1.8, outputPerMillion: 10.8 }
  ],
  "doubao-seed-2-0-pro": [
    { maxInputTokens: 32_000, inputPerMillion: 3.2, outputPerMillion: 16.0 },
    { maxInputTokens: 128_000, inputPerMillion: 4.8, outputPerMillion: 24.0 },
    { maxInputTokens: 256_000, inputPerMillion: 9.6, outputPerMillion: 48.0 }
  ],
  "deepseek-v3-2": [
    { maxInputTokens: 32_000, inputPerMillion: 2.0, outputPerMillion: 3.0 },
    { maxInputTokens: 128_000, inputPerMillion: 4.0, outputPerMillion: 6.0 }
  ]
};

function normalizeModel(modelId: string) {
  if (modelId.startsWith("doubao-seed-2-0-mini")) return "doubao-seed-2-0-mini";
  if (modelId.startsWith("doubao-seed-2-0-lite")) return "doubao-seed-2-0-lite";
  if (modelId.startsWith("doubao-seed-2-0-pro")) return "doubao-seed-2-0-pro";
  if (modelId.startsWith("deepseek-v3-2")) return "deepseek-v3-2";
  return null;
}

export function estimateCostCny(modelId: string, inputTokens?: number, outputTokens?: number) {
  const norm = normalizeModel(modelId);
  if (!norm) return null;
  const tiers = PRICING[norm];
  if (!tiers) return null;
  const inTok = Math.max(0, inputTokens || 0);
  const outTok = Math.max(0, outputTokens || 0);
  const tier = tiers.find((t) => inTok <= t.maxInputTokens) || tiers[tiers.length - 1];
  const cost = (inTok / 1_000_000) * tier.inputPerMillion + (outTok / 1_000_000) * tier.outputPerMillion;
  return Number(cost.toFixed(6));
}

