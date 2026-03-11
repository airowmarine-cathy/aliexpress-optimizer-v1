import { GoogleGenAI, Type } from "@google/genai";
import { FactSheet } from "./factSheetService";

export interface SEOData {
  optimized_title: string;
  character_count: number;
  core_keywords_embedded: string[];
  modification_reasons: string;
}

export const SEO_PROMPT_SYSTEM = `
ROLE: You are an Indexing Architect specializing in AliExpress SEO.
OBJECTIVE: Generate a high-weight SEO title based on the provided Fact Sheet and Original Title.

STRICT RULES & IRON LAWS:
1. REFERENCE VALIDATION: Every attribute (Material, Size, Spec) in the title MUST be present in the Fact Sheet. NO FABRICATION.
2. NO OWN BRANDS: Do not include the seller's own brand name or meaningless marketing fluff (e.g., "Free Shipping", "Hot Sale").
3. COMPATIBILITY EXEMPTION: If the Fact Sheet contains "compatibility" data (e.g., "for Toyota"), it MUST be included in the title.
4. THE FIRST 4 WORDS RULE: The absolute core product noun MUST appear within the first 4 words of the title.
5. COMMA SEPARATION: Use commas (,) to separate different attribute blocks. Ensure a space follows every comma.
6. CAPITALIZATION: Title Case for nouns/verbs/adjectives. lowercase for prepositions/articles (e.g., for, with, in).
7. ALGORITHM MATCHING: 
   - ENUMERATION OVER RANGES: When continuous years/models span ≤ 3, expand them (e.g., "2010-2012" to "2010 2011 2012"). When span > 3, DO NOT expand, keep hyphenated (e.g., "1998-2011" or "F150-F250").
   - DUAL UNITS: For length or weight, provide both metric and imperial units if possible (e.g., 100cm/39inch).
   - NUMBERS: Always use Arabic numerals (e.g., "1" not "One", "16Pcs" not "Sixteen pieces").
8. LENGTH: MUST be strictly between 110 and 128 characters. If the extracted core words are insufficient, you MUST pad the title by extracting synonyms, applicable scenarios from the Fact Sheet, or adding high-conversion industry terms (e.g., Premium Quality, Replacement Part, Auto Accessories) until the length reaches at least 110 characters.

DUAL-TRACK FORMULA (Choose based on Fact Sheet's category_matrix):
- FORMULA A (For Industrial, Productivity, Outdoor): 
  [Core Keyword] + [Main Parameters] + [Secondary Parameters] + [Compatibility (if any)] + [Core Selling Points] + [Scenarios]
- FORMULA B (For Home, Fashion): 
  [Precise Core Keyword 1] + [Attributes] + [Similar Core Keyword 2] + [Attributes] + [Broad Keyword 3] + [Scenarios]

OUTPUT: Include the character count of the optimized title, the core keywords used, and a brief explanation of the modifications in Simplified Chinese.
`;

export const SEO_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    optimized_title: {
      type: Type.STRING,
      description: "The final SEO optimized title",
    },
    character_count: {
      type: Type.INTEGER,
      description: "The character count of the optimized title",
    },
    core_keywords_embedded: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Keywords used from suggested_keywords",
    },
    modification_reasons: {
      type: Type.STRING,
      description: "Explanation in Simplified Chinese",
    },
  },
  required: ["optimized_title", "character_count", "core_keywords_embedded", "modification_reasons"],
};

export async function optimizeTitle(factSheet: FactSheet, originalTitle: string): Promise<SEOData> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `Original Title: ${originalTitle}\n\nFact Sheet: ${JSON.stringify(factSheet)}`,
    config: {
      systemInstruction: SEO_PROMPT_SYSTEM,
      responseMimeType: "application/json",
      responseSchema: SEO_RESPONSE_SCHEMA,
    },
  });

  try {
    return JSON.parse(response.text || "{}") as SEOData;
  } catch (e) {
    throw new Error("Failed to parse SEO AI response");
  }
}
