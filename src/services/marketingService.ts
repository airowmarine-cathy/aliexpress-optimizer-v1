import { GoogleGenAI, Type } from "@google/genai";
import { FactSheet } from "./factSheetService";

export interface MarketingPoint {
  header: string;
  content: string;
}

export interface MarketingData {
  category_matrix: 'Industrial' | 'Productivity' | 'Home' | 'Fashion' | 'Outdoor';
  points: MarketingPoint[];
}

export const MARKETING_PROMPT_SYSTEM = `
ROLE: You are a Conversion Architect specializing in E-commerce Marketing.
OBJECTIVE: Generate the "Golden 3-5 Point" description based ONLY on the provided Fact Sheet.

DYNAMIC SLOT MODEL LOGIC:
1. SLOT ALLOCATION:
   - Slot 1-3: Hardcore functional advantages based on Material and Technical Specs.
   - Slot 4: Application Scenario based on the Style Matrix (Priority: "You" perspective).
   - Slot 5: Value-add (Portability, Easy Install, etc.) - ONLY if facts are available.
2. QUANTITY CONTROL: 
   - Generate 3 to 5 points. 
   - Prioritize 5 points, but REDUCE to 4 or 3 if data is insufficient. 
   - NEVER FABRICATE DATA.

STYLE MATRIX ROUTING:
- Industrial: Authoritative, precise. Focus on stability and compliance.
- Productivity: Efficient, logical. Focus on compatibility and ergonomics.
- Home: Warm, reassuring. Focus on safety and family convenience.
- Fashion: Sensual, elegant. Focus on design and tactile feel.
- Outdoor: Energetic, durable. Focus on performance in extreme environments.

STRICT RULES:
- FORMULA: [Bold Header]: [Verb/Adjective starting description].
- NUMBERS: Must include specific numbers or percentages where available.
- INVISIBLE ENDORSEMENT: Embed certifications (CE, RoHS, etc.) as adjectives within points. Do not create standalone points for them.
- PERSPECTIVE: Prioritize "You" perspective for scenarios.
- LANGUAGE: Standard E-commerce English.
`;

export const MARKETING_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    category_matrix: {
      type: Type.STRING,
      enum: ["Industrial", "Productivity", "Home", "Fashion", "Outdoor"],
      description: "The style matrix used",
    },
    points: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          header: { type: Type.STRING, description: "The bold header text" },
          content: { type: Type.STRING, description: "The detailed marketing content" },
        },
        required: ["header", "content"],
      },
      description: "Array of 3-5 marketing points",
    },
  },
  required: ["category_matrix", "points"],
};

export async function generateMarketingPoints(factSheet: FactSheet): Promise<MarketingData> {
  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Fact Sheet: ${JSON.stringify(factSheet)}`,
    config: {
      systemInstruction: MARKETING_PROMPT_SYSTEM,
      responseMimeType: "application/json",
      responseSchema: MARKETING_RESPONSE_SCHEMA,
    },
  });

  try {
    return JSON.parse(response.text || "{}") as MarketingData;
  } catch (e) {
    throw new Error("Failed to parse Marketing AI response");
  }
}
