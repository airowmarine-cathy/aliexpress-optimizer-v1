import { GoogleGenAI, Type } from "@google/genai";

export interface FactSheet {
  material: string;
  dimensions: string;
  technical_specs: Record<string, string>;
  certifications: string[];
  suggested_keywords: string[];
  category_matrix: 'Industrial' | 'Productivity' | 'Home' | 'Fashion' | 'Outdoor';
  compatibility?: string[];
}

export const FACT_SHEET_PROMPT_SYSTEM = `
ROLE: You are a Data Scientist specializing in E-commerce Product Information Management (PIM).
OBJECTIVE: Extract a structured, "dehydrated" Fact Sheet from raw product data.

DATA SOURCE HIERARCHY:
1. HIGHEST WEIGHT: Custom Attributes (Key-Value pairs).
2. SUPPLEMENTARY/VALIDATION: Description HTML. Use this to expand on or verify Custom Attributes.
3. REFERENCE: Original Title. Use this to identify core keywords.

EXTRACTION RULES:
- EXTRACT: Material, Dimensions/Size, Technical Specifications (Power, Capacity, Interface, etc.), and Certifications (CE, RoHS, FDA, etc.).
- EXCLUDE: Seller's own Brand Names, Model Numbers, Warranty information, and Marketing Fluff.
- CRITICAL EXCEPTION FOR PARTS/ACCESSORIES: You MUST EXTRACT and RETAIN any compatible brands or models the product fits (e.g., "for Toyota", "fit for BMW", "compatible with iPhone 15"). Store this in the "compatibility" field.
- STANDARDIZATION: All output MUST be in standard E-commerce English. Translate if necessary.
- VALIDATION: If Description contradicts Custom Attributes, prioritize the more specific/logical data point.

CATEGORY MATRIX ROUTING:
- Industrial: Machinery, Tools, Auto Parts (functional), Security.
- Productivity: Computers, Office Electronics, 3D Printing, Stationery.
- Home: Home Decor, Appliances, Mother & Baby, Pets.
- Fashion: Clothing, Jewelry, Wedding, Watches.
- Outdoor: Sports, Toys, Fishing, Adventure.

OUTPUT: Valid JSON only.
`;

export const FACT_SHEET_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    material: { type: Type.STRING, description: "Primary materials used" },
    dimensions: { type: Type.STRING, description: "Size, weight, or dimensions" },
    technical_specs: { 
      type: Type.OBJECT, 
      additionalProperties: { type: Type.STRING },
      description: "Key technical parameters" 
    },
    certifications: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "List of certifications found" 
    },
    suggested_keywords: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "5-8 core SEO keywords" 
    },
    category_matrix: { 
      type: Type.STRING, 
      enum: ["Industrial", "Productivity", "Home", "Fashion", "Outdoor"],
      description: "The style matrix this product belongs to"
    },
    compatibility: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of compatible brands/models (e.g., 'for Toyota'). Empty if not applicable."
    }
  },
  required: ["material", "dimensions", "technical_specs", "certifications", "suggested_keywords", "category_matrix", "compatibility"]
};

export async function extractFactSheet(title: string, customAttributes: any, descriptionHtml: string): Promise<FactSheet> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  
  // Deep Parsing: We keep more HTML structure for Pro model to analyze
  const prepareContent = (html: string) => {
    if (!html) return "No description available.";
    // Remove scripts and styles but keep tables and lists structure
    let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    
    // If too long, we take the first 8000 chars for Pro model
    return cleaned.slice(0, 8000);
  };

  const richDescription = prepareContent(descriptionHtml);
  const attributesStr = typeof customAttributes === 'string' ? customAttributes : JSON.stringify(customAttributes, null, 2);

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      { 
        text: `你是一个专业的产品数据专家。请从以下三个维度深度解析并提取产品事实清单（Fact Sheet）：
        
1. 原始标题 (Original Title): ${title}
2. 自定义属性 (Custom Attributes): ${attributesStr}
3. 产品详细描述 (Description HTML): 
${richDescription}

【核心路径（Primary）】：
利用 Gemini 3.1 Pro 的长文本理解能力，深度解析“产品详细描述 (HTML)”和“原始标题”。
从复杂的 HTML 标签（尤其是 <table>, <ul>, <ol>）中剥离出材质、规格、技术参数等硬核数据。

【提取规则】：
- 优先级：自定义属性 > 详细描述中的表格/列表 > 原始标题。
- 目标：提取材质 (Material)、规格尺寸 (Dimensions)、技术参数 (Technical Specs)、认证信息 (Certifications)。
- 排除：品牌名、型号、营销话术、保修/售后信息。
- 语言：所有输出必须使用专业、地道的电商英文。`
      }
    ],
    config: {
      systemInstruction: FACT_SHEET_PROMPT_SYSTEM,
      responseMimeType: "application/json",
      responseSchema: FACT_SHEET_SCHEMA,
    },
  });

  try {
    return JSON.parse(response.text || "{}") as FactSheet;
  } catch (e) {
    console.error("FactSheet extraction failed:", e);
    throw new Error("Failed to extract FactSheet");
  }
}
