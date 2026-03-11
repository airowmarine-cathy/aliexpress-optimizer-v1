import { GoogleGenAI, Type } from "@google/genai";

export interface VisualAssetConfig {
  id: number;
  title: string;
  aspect: string;
  size: string;
  strategy: string;
  use: string;
  overlay?: {
    type: 'selling_points' | 'dimensions' | 'trust' | 'none';
    maxTitleLen?: number;
    maxDescLen?: number;
  };
}

export const VISUAL_MATRIX: VisualAssetConfig[] = [
  {
    id: 1,
    title: "主图白底",
    aspect: "1:1",
    size: "1K",
    strategy: "极致纯净，基于“白底图”原图重塑高保真质感。完全移除背景，替换为纯白 (#FFFFFF)。",
    use: "首图/直通车",
    overlay: { type: 'none' }
  },
  {
    id: 2,
    title: "卖点描述 A",
    aspect: "1:1",
    size: "1K",
    strategy: "AI 生成功能演示底图。展示产品在实际使用中的状态。",
    use: "详情页/副图",
    overlay: { type: 'selling_points', maxTitleLen: 15, maxDescLen: 30 }
  },
  {
    id: 3,
    title: "卖点描述 B",
    aspect: "1:1",
    size: "1K",
    strategy: "AI 生成材质特写底图。强调产品的高级质感和工艺细节。",
    use: "详情页/副图",
    overlay: { type: 'selling_points', maxTitleLen: 15, maxDescLen: 30 }
  },
  {
    id: 4,
    title: "规格尺寸图",
    aspect: "1:1",
    size: "1K",
    strategy: "AI 生成 45° 侧视图，背景为干净的浅灰色或网格底图。",
    use: "副图",
    overlay: { type: 'dimensions' }
  },
  {
    id: 5,
    title: "场景图 A",
    aspect: "1:1",
    size: "1K",
    strategy: "参考“场景图”原图风格，生成标准使用环境图。光影自然融合。",
    use: "副图/详情页",
    overlay: { type: 'none' }
  },
  {
    id: 6,
    title: "场景图 B",
    aspect: "1:1",
    size: "1K",
    strategy: "细节特写场景，强调产品局部工艺与环境的和谐。",
    use: "副图/详情页",
    overlay: { type: 'none' }
  },
  {
    id: 7,
    title: "氛围场景图",
    aspect: "3:4",
    size: "1K",
    strategy: "广角生活方式图，强调氛围感。适合速卖通 Feed 流。",
    use: "速卖通 Feed 频道",
    overlay: { type: 'none' }
  },
  {
    id: 8,
    title: "情感详情图",
    aspect: "9:16",
    size: "1K",
    strategy: "沉浸式多场景拼贴（由AI生成一张综合大图），强化“拥有感”和情感代入。",
    use: "详情页海报",
    overlay: { type: 'none' }
  },
  {
    id: 9,
    title: "信任详情图",
    aspect: "9:16",
    size: "1K",
    strategy: "条件触发：若有工厂图则重绘专业工厂感；否则生成高科技服务保障底图。",
    use: "详情页底部",
    overlay: { type: 'trust' }
  }
];

export interface VisualAnalysis {
  brandColor: string;
  hasFactoryImage: boolean;
  hasWarehouseImage: boolean;
  visualTraits: string;
}

export async function analyzeVisuals(
  productImage: string,
  descriptionHtml: string,
  fetchBase64: (url: string) => Promise<{data: string, mimeType: string} | null>
): Promise<VisualAnalysis> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('未找到 API Key');
  const ai = new GoogleGenAI({ apiKey });

  const analysisPrompt = `你是一个专业的电商视觉总监。请分析提供的产品图片（优先）和描述HTML。
任务：
1. 识别产品的主导品牌色（Dominant Brand Color）。请优先从产品图片（Logo、包装或产品本身的关键点缀色）中提取。避开纯白、纯黑背景色。返回一个具有高级感、符合品牌调性的十六进制色值（如 #FF6321）。
2. 扫描HTML描述，判断是否包含真实的工厂（Factory）或仓库（Warehouse）照片。
3. 提取产品的核心视觉特征（Visual Traits），包括材质感（如磨砂、金属、透明）、形状特征、关键图案等，用于后续AI高保真生图。

严格输出 JSON 格式。`;

  const mainImgData = await fetchBase64(productImage);
  
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      { text: analysisPrompt + `\n\nHTML Content:\n${descriptionHtml}` },
      ...(mainImgData ? [{ inlineData: { data: mainImgData.data, mimeType: mainImgData.mimeType } }] : [])
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          brandColor: { type: Type.STRING },
          hasFactoryImage: { type: Type.BOOLEAN },
          hasWarehouseImage: { type: Type.BOOLEAN },
          visualTraits: { type: Type.STRING }
        },
        required: ["brandColor", "hasFactoryImage", "hasWarehouseImage", "visualTraits"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
}
