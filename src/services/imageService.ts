import { GoogleGenAI } from "@google/genai";

export interface RemasteredImage {
  originalUrl: string;
  remasteredUrl: string;
  category: string;
  riskReport?: string[];
}

export const CATEGORY_STYLES: Record<string, string> = {
  'Industrial': 'Clean studio lighting, pure white background, sharp focus, professional industrial photography',
  'Home': 'Soft natural daylight, blurred cozy interior background, warm tones, lifestyle vibe',
  'Outdoor': 'Natural sunlight, outdoor depth of field, energetic, blue sky or grass hint',
  'Fashion': 'High-end editorial lighting, neutral grey or beige background, minimalist',
  'Kids': 'Bright high-key lighting, soft pastel background, playful but clean',
  'Electronics': 'Tech-noir lighting, subtle reflection, dark gradient or sleek surface',
  'General': 'Clean white background, studio lighting, professional e-commerce product photography'
};

export async function detectImageCategory(
  productName: string,
  imageUrl: string,
  fetchBase64: (url: string) => Promise<{data: string, mimeType: string} | null>
): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return 'General';
  
  try {
    const ai = new GoogleGenAI({ apiKey });
    // Use a lightweight model for classification
    const prompt = `
      Analyze this product and categorize it into ONE of these styles:
      [Industrial, Home, Outdoor, Fashion, Kids, Electronics, General]
      
      Product Name: ${productName}
      
      Return ONLY the category name.
    `;

    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt
    });
    const category = (result.text || "").trim();
    
    // Validate
    if (CATEGORY_STYLES[category]) {
      return category;
    }
    // Fuzzy match
    const found = Object.keys(CATEGORY_STYLES).find(k => category.includes(k));
    return found || 'General';
  } catch (e) {
    console.error("Category detection failed:", e);
    return 'General';
  }
}

export async function remasterImageV1_Scene(
  imageUrl: string,
  productName: string,
  category: string,
  fetchBase64: (url: string) => Promise<{data: string, mimeType: string} | null>,
  factSheet?: any // Optional FactSheet for context
): Promise<RemasteredImage> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('未找到 API Key');
  const ai = new GoogleGenAI({ apiKey });

  // 1. Fetch Image
  let base64Data;
  try {
    base64Data = await fetchBase64(imageUrl);
  } catch (e) {
    throw new Error(`图片下载失败: ${e.message}`);
  }
  
  if (!base64Data) throw new Error('无法获取图片数据 (可能是跨域或链接无效)');

  // 2. Step 6.1: Scene Reasoning (Think)
  // Use Gemini 3 Flash to generate a detailed scene description
  let sceneDescription = "";
  try {
    const reasoningPrompt = `
      You are an expert e-commerce art director.
      Product: ${productName}
      Category: ${category}
      ${factSheet?.material ? `Material: ${factSheet.material}` : ''}
      ${factSheet?.usage ? `Usage: ${factSheet.usage}` : ''}
      
      Task: Describe a perfect, high-converting background setting for this product.
      Requirements:
      1. The setting must be realistic and relevant to the product's usage (e.g., if it's furniture, describe a room; if outdoor gear, describe nature).
      2. Describe the floor/surface (e.g., wooden table, marble counter, grass, concrete).
      3. Describe the lighting (e.g., soft sunlight, studio lighting, warm cozy light).
      4. CRITICAL: The background must NOT be plain white. It must be a real scene.
      
      Output: A single paragraph describing the scene visually.
    `;

    const reasoningResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: reasoningPrompt
    });
    sceneDescription = reasoningResponse.text || "";
    console.log(`[Step 6] Generated Scene: ${sceneDescription}`);
  } catch (e) {
    console.warn("[Step 6] Scene reasoning failed, falling back to default.", e);
    sceneDescription = `A professional e-commerce photography setting for ${category}, with soft lighting and a neutral but textured background (not plain white).`;
  }

  // 3. Step 6.2: Image Remastering (Draw)
  // Use Gemini 2.5 Flash Image with the generated scene description
  const prompt = `
    Role: Expert E-commerce Image Editor.
    Task: Clean and Remaster the input image to be a high-converting main product image.
    
    Product Context:
    - Name: ${productName}
    - Scene: ${sceneDescription}
    
    Strict Instructions:
    1. SUBJECT PRESERVATION (CRITICAL): The main product object MUST remain EXACTLY the same shape, structure, and color as the original image. Do NOT distort or hallucinate new features.
    2. CLEANING: REMOVE all text overlays, watermarks, promotional badges, and unauthorized logos from the original image.
    3. BACKGROUND: COMPLETELY REMOVE the original background. Place the product in the following NEW environment: ${sceneDescription}
    4. NO WHITE BACKGROUND: The final image must have a realistic scene, NOT plain white.
    5. OUTPUT: A high-quality, photorealistic image suitable for an e-commerce listing.
  `;

  // 4. Call Edit Model with Retry
  const MAX_RETRIES = 2;
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: { 
          parts: [
            { text: prompt },
            { inlineData: { data: base64Data.data, mimeType: base64Data.mimeType } }
          ]
        },
      });

      // 5. Extract Image
      const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!part || !part.inlineData) {
        throw new Error('模型未返回图片数据');
      }

      const remasteredUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;

      return {
        originalUrl: imageUrl,
        remasteredUrl,
        category
      };
    } catch (error: any) {
      console.warn(`Remaster attempt ${attempt + 1} failed:`, error);
      lastError = error;
      // Wait before retry (1s, 2s)
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw new Error(`AI 处理失败 (重试 ${MAX_RETRIES} 次后): ${lastError.message || '未知错误'}`);
}

function extractVisualContext(factSheet?: any): string {
  if (!factSheet) return '';

  const visualLines: string[] = [];

  if (factSheet.material && factSheet.material.toLowerCase() !== 'unknown') {
    visualLines.push(`- Material/Texture: ${factSheet.material}`);
  }

  if (factSheet.dimensions && factSheet.dimensions.toLowerCase() !== 'unknown') {
    visualLines.push(`- Dimensions/Proportions: ${factSheet.dimensions}`);
  }

  if (factSheet.technical_specs) {
    const visualKeywords = [
      'quantity', 'piece', 'pcs', 'set', 'pair',
      'finish', 'surface', 'texture',
      'type', 'style', 'shape', 'form'
    ];
    const extractedSpecs: string[] = [];

    for (const [key, value] of Object.entries(factSheet.technical_specs)) {
      const lowerKey = key.toLowerCase();
      if (visualKeywords.some(keyword => lowerKey.includes(keyword))) {
        extractedSpecs.push(`${key}: ${value}`);
      }
    }

    if (extractedSpecs.length > 0) {
      visualLines.push(`- Visual Specifications: ${extractedSpecs.join(', ')}`);
    }
  }

  if (visualLines.length === 0) return '';
  return `${visualLines.join('\n')}`;
}

export async function remasterImage(
  imageUrl: string,
  productName: string,
  category: string,
  fetchBase64: (url: string) => Promise<{data: string, mimeType: string} | null>,
  factSheet?: any
): Promise<RemasteredImage> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('未找到 API Key');
  const ai = new GoogleGenAI({ apiKey });

  // 1. Fetch Image
  let base64Data;
  try {
    base64Data = await fetchBase64(imageUrl);
  } catch (e: any) {
    throw new Error(`图片下载失败: ${e.message}`);
  }
  
  if (!base64Data) throw new Error('无法获取图片数据 (可能是跨域或链接无效)');

  const visualContext = extractVisualContext(factSheet);

  // 2. Step 6.2: Image Remastering 2.0 (Pure White Background)
  const prompt = `
Role: Expert E-commerce Image Editor & Compliance Reviewer.
Task: Remaster the input image into a highly converting, platform-compliant pure white background product image.

Product Context:
- Name: ${productName}
${visualContext}

CRITICAL DIRECTIVES (Must Follow):
1. PURE WHITE BACKGROUND (CRITICAL): Completely remove the original background. The new background MUST be absolute pure white (RGB 255, 255, 255 / #FFFFFF). No gradients, no gray, no off-white.
2. SUBJECT PRESERVATION (CRITICAL) (ZERO HALLUCINATION): The main product MUST remain EXACTLY the same shape, structure, color, and camera angle. DO NOT distort, rotate, or hallucinate new features.
   - Do NOT change the number of items. If the original image shows a pair (e.g., 2 covers), the output MUST show exactly 2 covers.
   - Do NOT change the camera angle or perspective. If it's a side view, keep it a side view. Do NOT force it into a front view.
   - Do NOT alter the physical shape, structure, or add non-existent parts.
3. GROUNDING SHADOW: Add a soft, natural, and realistic drop shadow directly beneath the product to ground it. It must NOT look like it is floating in the air. Ensure the shadow direction is physically consistent with the lighting.
4. COMPOSITION: Center the product perfectly. The product should occupy roughly 70% to 85% of the frame (1:1 square ratio), leaving comfortable breathing room at the edges.
5. CLEANUP & RED LINES: STRICTLY REMOVE ALL text overlays, watermarks, store logos, promotional badges, colored borders, and ANY irrelevant background props or human hands.
6. LIGHTING & TEXTURE ENHANCEMENT (THE "MAGIC"):
   - Apply professional studio lighting to make the product look premium.
   - Smooth out harsh glares or messy environmental reflections on the product surface, but keep the natural material texture (e.g., glossy plastic, matte metal).

FAILURE CONDITION: Any alteration to the product's original quantity, physical structure, or camera perspective will result in immediate rejection.
  `;

  // 3. Call Edit Model with Retry
  const MAX_RETRIES = 2;
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: { 
          parts: [
            { text: prompt },
            { inlineData: { data: base64Data.data, mimeType: base64Data.mimeType } }
          ]
        },
      });

      // 4. Extract Image
      const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!part || !part.inlineData) {
        throw new Error('模型未返回图片数据');
      }

      const remasteredUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;

      return {
        originalUrl: imageUrl,
        remasteredUrl,
        category: 'WhiteBackground'
      };
    } catch (error: any) {
      console.warn(`Remaster attempt ${attempt + 1} failed:`, error);
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw new Error(`AI 处理失败 (重试 ${MAX_RETRIES} 次后): ${lastError?.message || '未知错误'}`);
}
