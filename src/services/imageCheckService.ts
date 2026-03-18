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
  fetchBase64: (url: string) => Promise<{data: string, mimeType: string} | null>,
  context?: { productName?: string, compatibility?: string[], removeSupplierInfo?: boolean }
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
    
    const productName = context?.productName || '未知产品';
    const compatibility = context?.compatibility?.join(', ') || '无';
    const removeSupplierInfo = context?.removeSupplierInfo || false;

    const prompt = `
      Role: 资深跨境电商内容审核专家。
      Task: 准确识别并标记出旨在“站外引流”或“私下交易”的名片式图片，同时避免误杀正常的产品展示图。

      [产品上下文]
      - 产品名称: ${productName}
      - 适用/兼容品牌: ${compatibility}

      [审核逻辑与标准]
      请仔细观察图片，并按照以下步骤进行推理：

      第一步：判断图片类型 (Image Type)
      - 类型 A (名片/引流海报)：图片的主体是大量的文字、联系方式、公司简介。排版类似于名片、售后卡、或者纯粹的广告海报。
      - 类型 B (产品展示图)：图片的主体是产品本身。任何文字、Logo 或二维码都是物理附着在产品机身、标签或包装盒上的。
      ${removeSupplierInfo ? '- 类型 C (供应商/工厂展示)：图片主体是工厂大楼、生产车间、办公室、团队合照、营业执照或“关于我们”介绍。' : ''}

      第二步：执行判定规则
      - 如果是【类型 A】：
        - 重点打击“私下交易”：如果图片包含 电话、WhatsApp、WeChat、Email、二维码 中的【多项组合】，或者伴随“Contact us”等强引导文案，判定为违规 (isRisky: true)。
        - 豁免规则：如果仅仅是包含认证证书的网址（如 ISO、BSCI、TUV）或简单的品牌域名水印（无引导性文案），属于正常信息展示，【不违规】 (isRisky: false)。

      - 如果是【类型 B】：
        - 允许产品机身或包装上自带的二维码（通常是防伪或说明书）。
        - 允许出现【适用/兼容品牌】的 Logo。
        - 只有当图片上被后期人为添加了明显的引流文字（如大字体的“Contact us: +86...”）时，才判定为违规。否则，判定为安全 (isRisky: false)。

      - 无论哪种类型，【FDA 违规红线】：如果图片中包含 FDA 的 Logo，或者包含 "FDA Approved", "FDA Certified", "FDA Cleared", "FDA Registered" 等任何 FDA 相关的宣称字眼，一律判定为违规 (isRisky: true)。

      ${removeSupplierInfo ? '- 如果是【类型 C】：\n        - 判定为违规 (isRisky: true)。\n        - 理由：用户开启了“移除供应商信息”功能，此类图片属于公司/团队展示。' : ''}

      OUTPUT FORMAT (JSON ONLY):
      {
        "imageType": "A" or "B" ${removeSupplierInfo ? 'or "C"' : ''},
        "reasoning": "简短解释你的判断过程，例如：这是一张名片，包含大量联系方式 / 这是产品实拍图，二维码是机身上的警告标签",
        "isRisky": boolean,
        "reason": "如果违规，用中文简述原因（如：名片式引流图片 / 包含竞品Logo）。如果不违规，填 null"
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
