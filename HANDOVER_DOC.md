# 全球商品智能优化系统 V2.0 - 技术交接文档

## 1. 项目概述

本项目是一个基于 React + Vite 的前端单页应用（SPA），旨在为跨境电商提供全链路的产品信息智能优化服务。系统通过读取用户上传的 Excel 产品表，利用 Google Gemini 大语言模型（GenAI API）对产品数据进行深度解析和重构，最终输出优化后的 SEO 标题、营销卖点、清洗后的属性和描述，并附带图片合规检测与首图重绘功能。

**核心价值**：将非标准化的原始商品数据，转化为符合欧美电商平台标准、高转化率的结构化数据。

## 2. 技术栈与架构

*   **前端框架**：React 18 + Vite
*   **语言**：TypeScript
*   **样式**：Tailwind CSS
*   **图标**：`lucide-react`
*   **Excel 处理**：`xlsx` (读取), `file-saver` (导出)
*   **AI 核心驱动**：`@google/genai` (Gemini 3.1 Pro / Gemini 3 Flash)
*   **图床服务**：ImgBB API (用于首图重绘后的图片托管)
*   **数据同步**：Google Sheets API (通过 Google Apps Script 部署的 Web App 接收数据)

### 2.1 核心目录结构

```text
/src
  ├── App.tsx                 # 主应用组件，包含 UI 渲染、文件上传、队列调度逻辑
  ├── index.css               # 全局样式 (Tailwind 引入)
  ├── main.tsx                # React 挂载点
  └── services/               # 核心业务逻辑层 (AI 交互)
      ├── factSheetService.ts # 核心：事实清单提取 (Gemini 3.1 Pro)
      ├── seoService.ts       # SEO 标题优化 (Gemini 3 Flash)
      ├── marketingService.ts # 黄金五点营销文案生成 (Gemini 3 Flash)
      ├── attributeService.ts # 属性清洗与标准化 (Gemini 3.1 Pro)
      ├── descriptionService.ts# 详情页描述清洗与排版 (Gemini 3.1 Pro)
      ├── imageService.ts     # 首图重绘 (Gemini 2.5 Flash Image)
      └── imageCheckService.ts# 图片合规与侵权检测 (Gemini 3 Flash)
```

## 3. 核心业务流程 (Pipeline)

系统采用**流水线 (Pipeline)** 模式处理每个产品，步骤严格按顺序执行，前置步骤的输出是后置步骤的输入。

1.  **文件解析**：读取 Excel，初始化 `ProductPipeline` 状态。
2.  **云端同步 (初始)**：将原始数据发送至 Google Sheets。
3.  **Fact Sheet 提取 (核心基石)**：深度解析原始标题、属性和 HTML 描述，提取出纯净的“事实清单”（材质、尺寸、技术参数等）。**后续所有文本优化均依赖此数据，以确保不产生幻觉。**
4.  **SEO 标题优化**：基于 Fact Sheet 生成符合电商规范的标题。
5.  **黄金五点生成**：基于 Fact Sheet 生成 3-5 点营销文案。
6.  **属性清洗**：结合原始属性和 Fact Sheet，进行去重、翻译和风险词剔除。
7.  **描述清洗**：清理原始 HTML 中的冗余标签、内联样式和风险词，重构为干净的 PC 端和移动端 HTML。
8.  **图片合规检测**：提取描述中的图片 URL，调用 AI 识别侵权风险（人物面部、竞品 Logo 等）。
9.  **首图重绘**：调用图像大模型，去除原图背景，生成纯白底或指定场景的高清首图，并上传至 ImgBB。
10. **云端同步 (完成)**：将优化后的最终数据追加到 Google Sheets。

## 4. ⚠️ 极其重要的开发规范（红线警告）

接手本项目的开发者必须严格遵守以下规范，**任何对底层逻辑的私自改动都可能导致整个优化链路崩溃或产出质量严重下降。**

### 4.1 绝对禁止随意修改 Prompt (提示词)

`src/services/` 目录下的每个文件中都定义了专属的 `PROMPT_SYSTEM`。这些 Prompt 是经过大量电商数据测试和调优的“核心资产”。

*   **禁止**：随意更改 Prompt 中的指令、规则、输出格式要求。
*   **禁止**：改变“基于 Fact Sheet 生成内容”的底层逻辑。AI 极易产生幻觉，Fact Sheet 是锚定事实的唯一保障。
*   **如果必须修改**：必须经过严格的 A/B 测试，确保在不同品类（Industrial, Fashion, Home 等）下均不出现数据捏造或格式错乱。

### 4.2 严格遵守 JSON Schema 约束

所有文本类 AI 调用均使用了 `responseSchema` 强制返回 JSON 格式。

*   **禁止**：修改 Schema 的数据结构（如将数组改为对象，或更改字段名），除非你同时修改了 `App.tsx` 中对应的渲染和导出逻辑。
*   **历史教训**：曾因 `marketingService.ts` 返回的对象数组在 `App.tsx` 中被直接渲染，导致过严重的 React 白屏崩溃 (White Screen of Death)。

### 4.3 API Key 的安全与调用规范

本项目运行在特殊的 AI Studio 容器环境中。

*   **唯一正确的调用方式**：
    ```typescript
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    ```
*   **禁止**：在业务代码中添加 `if (!process.env.GEMINI_API_KEY) throw new Error(...)` 这样的显式检查。Vite 前端环境无法直接读取 `process.env`，这种检查会导致程序立即崩溃。平台底层会自动拦截并注入 Key。

### 4.4 队列调度逻辑的稳定性

`src/App.tsx` 中的 `togglePipeline` 函数负责控制并发处理队列。

*   **禁止**：在 `while` 循环内部使用依赖于 React 异步状态更新（如 `setProducts(prev => ...)`）的逻辑来获取下一个任务。
*   **正确做法**：目前代码已使用同步的索引 (`currentIndex`) 和预先提取的数组 (`idleProducts`) 来管理队列，完美避开了竞态条件。请勿破坏此结构。

## 5. 已知问题与后续维护建议

1.  **图片跨域问题**：`fetchBase64String` 函数使用了公共的 CORS 代理 (`images.weserv.nl` 和 `corsproxy.io`) 来抓取外部图片。这些免费代理可能不稳定。**建议**：未来如有条件，应部署专属的图片中转服务。
2.  **ImgBB API Key**：目前 `uploadToImgBB` 中硬编码了一个免费的 API Key。**建议**：在生产环境中，应将其移至环境变量，并考虑使用更稳定的企业级图床（如 AWS S3, 阿里云 OSS）。
3.  **Google Sheets Web App URL**：目前硬编码在 `App.tsx` 中。如果重新部署了 Apps Script，必须同步更新此 URL。
4.  **模型版本**：目前使用了 `gemini-3.1-pro-preview` 和 `gemini-3-flash-preview`。请关注 Google GenAI 的版本更新，适时迁移到正式版模型。

## 6. 紧急故障排查指南

*   **症状：点击“开始批量优化”后，产品状态瞬间变成“处理中”，但进度条不动，子任务全是“等待生成”。**
    *   *排查*：检查 `togglePipeline` 中的队列调度逻辑是否被改回了异步状态依赖。
*   **症状：某个子任务（如 Fact Sheet）一启动就显示红色的 Error 图标。**
    *   *排查*：检查对应 Service 文件中的 API Key 初始化代码是否被错误修改（参考 4.3 节）。
*   **症状：某个子任务完成后，界面瞬间变成一片空白（白屏）。**
    *   *排查*：100% 是 React 渲染错误。检查该子任务返回的数据结构是否与 `App.tsx` 中的渲染逻辑匹配。绝不能将对象或数组直接作为 React 的子元素渲染。

---
*文档创建时间：2026-03-09*
