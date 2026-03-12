import { GoogleGenAI } from "@google/genai";

export interface ImageCheckResult {
  url: string;
  isRisky: boolean;
  reason?: string;
}

export interface ProductImageCheckReport {
  productId: string;
  images: ImageCheckResult[];
  hasRisk: boolean;
}

// Extract image URLs from HTML content
export function extractImagesFromHtml(html: string): string[] {
  if (!html) return [];
  const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
  const urls: string[] = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (match[1] && !match[1].startsWith('data:')) {
      urls.push(match[1]);
    }
  }
  return [...new Set(urls)]; // Deduplicate
}

// Remove specific image from HTML
export function removeImageFromHtml(html: string, imageUrl: string): string {
  if (!html) return '';
  // Create a regex that matches the img tag containing this specific src
  // We need to escape special characters in the URL for regex
  const escapedUrl = imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<img[^>]+src=["']${escapedUrl}["'][^>]*>`, 'g');
  return html.replace(regex, '');
}

// Check a single image for risk using Gemini Vision
export async function checkImageRisk(
  imageUrl: string, 
  fetchBase64: (url: string) => Promise<{data: string, mimeType: string} | null>
): Promise<ImageCheckResult> {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('未找到 API Key');
  
  try {
    const base64Data = await fetchBase64(imageUrl);
    if (!base64Data) {
      // Return null for isRisky to indicate "Unknown/Error" state
      // This will be handled by UI as a yellow warning
      return { url: imageUrl, isRisky: false, reason: '检测失败（网络错误）' };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `
      Role: Expert E-commerce Compliance Officer.
      Task: rigorous image audit for prohibited contact information.

      STEP 1: OCR & VISUAL SCAN
      - Scan the image for ANY text (English, Chinese, numbers, URLs).
      - Look for QR codes (WeChat, WhatsApp, Line, etc.).
      - Look for watermarks or logos with text.

      STEP 2: RISK ANALYSIS
      Check if the extracted text or visual elements contain:
      1. Phone numbers (e.g., +86..., 138...)
      2. Email addresses
      3. URLs / Website links
      4. Instant Messaging IDs (WhatsApp, WeChat, Skype, Line, etc.)
      5. QR Codes (ZERO TOLERANCE - ALWAYS RISKY)
      6. "Contact Us" or business card style text (ZERO TOLERANCE - ALWAYS RISKY)
      7. Competitor Brand Logos or Trademarks (e.g., Nike, Apple, Samsung)
      8. Text-heavy contact information screenshots (ZERO TOLERANCE - ALWAYS RISKY)

      OUTPUT FORMAT (JSON ONLY):
      {
        "isRisky": boolean,
        "reason": "发现 [手机号: 138xxxx] / [二维码] / [竞品Logo]" (必须用中文输出具体违规原因，如果没有违规填 null)
      }
    `;

    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: prompt }, { inlineData: { data: base64Data.data, mimeType: base64Data.mimeType } }] }
    });

    const text = result.text || "";
    // Handle markdown code blocks if present
    const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        url: imageUrl,
        isRisky: parsed.isRisky,
        reason: parsed.reason
      };
    }
    
    return { url: imageUrl, isRisky: false };

  } catch (e: any) {
    console.error(`Image check failed for ${imageUrl}:`, e);
    // Return explicit error reason so UI can show yellow warning
    return { url: imageUrl, isRisky: false, reason: `检测失败: ${e.message || '未知错误'}` };
  }
}
