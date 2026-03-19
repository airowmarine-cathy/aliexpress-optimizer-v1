const USD_TO_CNY = 7.2;

type GeminiPrice = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

// Estimated list prices. Adjust if your billing page shows updated rates.
const PRICING: Record<string, GeminiPrice> = {
  "gemini-3-flash-preview": {
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4
  },
  "gemini-2.0-flash-exp": {
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4
  },
  "gemini-2.5-flash-image": {
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 1.2
  }
};

function getPrice(modelId: string): GeminiPrice | null {
  for (const [key, price] of Object.entries(PRICING)) {
    if (modelId.startsWith(key)) return price;
  }
  return null;
}

export function estimateGeminiCostCny(modelId: string, inputTokens?: number, outputTokens?: number): number | null {
  const price = getPrice(modelId);
  if (!price) return null;
  const inTok = Math.max(0, Number(inputTokens || 0));
  const outTok = Math.max(0, Number(outputTokens || 0));
  const usd = (inTok / 1_000_000) * price.inputUsdPerMillion + (outTok / 1_000_000) * price.outputUsdPerMillion;
  const cny = usd * USD_TO_CNY;
  return Number(cny.toFixed(6));
}

