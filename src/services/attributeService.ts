import { GoogleGenAI, Type } from "@google/genai";
import { FactSheet } from "./factSheetService";

export interface OptimizedAttributes {
  original: string;
  optimized: string;
  changes: string[];
}

export const ATTRIBUTE_PROMPT_SYSTEM = `
ROLE: You are an E-commerce Data Sanitization Expert.
OBJECTIVE: Clean, translate, and enrich product custom attributes based on the "Incremental Repair + Risk Removal" strategy.

CRITICAL RULE: YOU MUST RETAIN ALL ORIGINAL ATTRIBUTES that do not violate the deduplication (Step 2) and risk removal (Step 3) rules. DO NOT summarize, condense, or arbitrarily drop any safe attributes. Missing safe original attributes is considered a FATAL ERROR.

STRICT 5-STEP PROCESS:

1. SMART SUPPLEMENT (INCREMENTAL):
   - Check the provided Fact Sheet for 'Material' and 'Dimensions/Size'.
   - IF missing in original attributes: Add them from Fact Sheet.
   - IF present in original attributes: KEEP ORIGINAL. DO NOT OVERWRITE.

2. DEDUPLICATION:
   - Remove semantically identical keys (e.g., 'Color' vs 'Colour'). Keep the most professional one.
   - Remove duplicate values.

3. RISK REMOVAL (STRICTEST):
   - DELETE ANY key/value related to:
     * Brand / Logo / Model Number (EXCEPTIONS APPLY, see below)
     * Warranty / Guarantee / Return Policy
     * MOQ / Minimum Order
     * OEM / ODM / Customization Services
     * Package / Packing / Carton Size
     * Shipping / Delivery Time / Freight
     * Payment Methods
     * Contact info (Email, Phone, WhatsApp, WeChat, Skype, URLs, or generic customer service invitations like "welcome contact with me")
   - COMPATIBILITY & COMPONENT EXEMPTION (CRITICAL): 
     * DO NOT remove brand/model names if they appear in the Fact Sheet's 'compatibility' or 'brand' fields.
     * DO NOT remove brand/model names if they follow prepositions like "for", "fit", "compatible with" (e.g., "for Toyota").
     * DO NOT remove brand/model names if they have suffixes like "style", "model", "type", "custom" (e.g., "JP style").
     * DO NOT remove third-party component brands (e.g., "Schaller tuner", "Alpha control").

4. TRANSLATION & STANDARDIZATION:
   - Translate ALL non-English characters to standard E-commerce English.
   - Format: Title Case for Keys (e.g., "Material"), Sentence Case for Values.

5. FACT CHECK:
   - Do NOT invent attributes not present in Original Attributes or Fact Sheet.

OUTPUT FORMAT:
- Return a single string of key-value pairs separated by newlines (\n).
- DO NOT add a space after the colon.
- Example: "Material:Oxford Cloth\nColor:Black\nFeature:Waterproof"
`;

export const ATTRIBUTE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    optimized_string: { 
      type: Type.STRING,
      description: "The final newline-separated string of attributes (e.g., Key:Value\\nKey2:Value2)"
    },
    changes_made: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of specific changes made (e.g., '[Brand] Removed \\'Nike\\' from \\'Brand: Nike\\'', 'Added Material from Fact Sheet')"
    }
  },
  required: ["optimized_string", "changes_made"]
};

export async function optimizeAttributes(originalAttributes: string, factSheet: FactSheet): Promise<{optimized: string, changes: string[]}> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      {
        text: `Original Attributes: ${originalAttributes}\n\nFact Sheet Data: ${JSON.stringify(factSheet, null, 2)}`
      }
    ],
    config: {
      systemInstruction: ATTRIBUTE_PROMPT_SYSTEM,
      responseMimeType: "application/json",
      responseSchema: ATTRIBUTE_SCHEMA,
    },
  });

  try {
    const result = JSON.parse(response.text || "{}");
    return {
      optimized: result.optimized_string || originalAttributes,
      changes: result.changes_made || []
    };
  } catch (e) {
    console.error("Attribute optimization failed:", e);
    return { optimized: originalAttributes, changes: ["Error during optimization"] };
  }
}
