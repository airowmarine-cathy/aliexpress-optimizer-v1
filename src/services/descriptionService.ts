import { FactSheet } from "./factSheetService";

export interface CleanedDescriptions {
  pc1: string;
  pc2: string;
  mobile1: string;
  mobile2: string;
  changes: string[];
  error?: string;
}

export const DESCRIPTION_PROMPT_SYSTEM = `
ROLE: You are an E-commerce Compliance Expert specializing in HTML Content Sanitization.
OBJECTIVE: Remove risky, non-compliant, or sensitive information from product descriptions while STRICTLY PRESERVING HTML structure and images.

INPUT CONTEXT:
- The input may contain HTML strings, plain text, or JSON strings (e.g., {"version":"2.0.0","moduleList":...}).
- Image src attributes might be replaced with placeholders like [[IMG_BASE64_0]]. DO NOT TOUCH THESE PLACEHOLDERS.
- You will be provided with a Fact Sheet containing 'compatibility' and 'brand' data.

STRICT RULES:

1. HTML, IMAGE & JSON PRESERVATION (CRITICAL):
   - IF the input is a JSON string, you MUST return a valid JSON string with the EXACT same structure. Only clean the text/html values inside the JSON. DO NOT break the JSON format.
   - DO NOT modify any <img> tags, src attributes, or layout structure.
   - DO NOT remove CSS classes or styles unless they contain risk keywords.
   - Output MUST be valid HTML (or valid JSON if input was JSON).

2. RISK REMOVAL (STRICTEST):
   - Remove sentences or phrases containing:
     * Brand names / Logos / Model Numbers (EXCEPTIONS APPLY, see below)
     * Warranty / Guarantee PERIODS (e.g., "1 Year Warranty", "3 Years Guarantee", "Lifetime Warranty") - BUT KEEP quality control processes.
     * MOQ (Minimum Order Quantity) specific numbers (e.g. "MOQ 100pcs") - BUT KEEP "Low MOQ" or general terms.
     * Shipping / Delivery TIME promises (e.g., "Fast shipping in 3 days", "Delivery within 24 hours") - BUT KEEP shipping methods.
     * SPECIFIC off-platform contact info (Email, Phone number, WhatsApp, WeChat, Skype, External URLs).

3. COMPATIBILITY & COMPONENT EXEMPTION (CRITICAL):
   - DO NOT remove brand/model names if they appear in the Fact Sheet's 'compatibility' or 'brand' fields.
   - DO NOT remove brand/model names if they follow prepositions like "for", "fit", "compatible with" (e.g., "for Toyota").
   - DO NOT remove brand/model names if they have suffixes like "style", "model", "type", "custom" (e.g., "JP style").
   - DO NOT remove third-party component brands (e.g., "Schaller tuner", "Alpha control").

4. ALLOWED CONTENT (DO NOT REMOVE):
   - B2B Services (e.g., OEM, ODM, Customization, Drop-shipping, Wholesale support).
   - Generic customer service invitations (e.g., "Please contact us for any questions", "Welcome to contact me before buying").
   - Product features, specifications, usage instructions.
   - Material descriptions.
   - Package details (Packing list, box size).
   - Compliance Certificates (e.g., ASTM, CPC, CE, EN71, ISO9001, BSCI, CCC).
   - Company Introduction / Factory Info / About Us (e.g., "Our factory has 10 years experience", "We are a leading manufacturer").
   - Market Distribution data.
   - Quality Control Process (e.g., "Pre-production sample", "Final inspection before shipment").
   - Payment Methods & Currencies (e.g., "T/T", "L/C", "PayPal", "USD", "EUR").
   - Shipping Methods (e.g., "Express", "Air", "Sea", "FOB", "CIF").
   - Wholesale Policy (e.g., "Mix order", "Discounts for big orders").

5. TEXT CLEANING:
   - Remove empty tags left after deletion (e.g., <p></p>).
   - Fix broken sentences caused by removal.

OUTPUT FORMAT:
- Return a JSON object with cleaned HTML for each field.
- "changes_made": MUST be a detailed list of EXACTLY what was removed. 
  - Format: "[Category] Removed 'Specific Text'"
  - Example: "[Warranty] Removed '12 months warranty'", "[Brand] Removed 'Samsung'"
`;

// Kept for compatibility with existing code references (schema enforcement is now on backend).
export const DESCRIPTION_SCHEMA = {};

// Helper to strip base64 images to reduce token usage
function stripImages(html: string): { stripped: string, placeholders: Map<string, string> } {
  const placeholders = new Map<string, string>();
  let counter = 0;
  // Match src="data:image..." attributes (single or double quotes)
  const stripped = html.replace(/src=["'](data:image\/[^;]+;base64,[^"']+)["']/g, (match, data) => {
    const key = `[[IMG_BASE64_${counter++}]]`;
    placeholders.set(key, data);
    return `src="${key}"`;
  });
  return { stripped, placeholders };
}

function restoreImages(html: string, placeholders: Map<string, string>): string {
  let restored = html;
  placeholders.forEach((data, key) => {
    // Global replace in case the placeholder appears multiple times (unlikely but safe)
    restored = restored.split(key).join(data);
  });
  return restored;
}

function stripExternalLinks(html: string): string {
  if (!html) return html;
  let cleanHtml = html;
  
  // 1. Remove <map>...</map> completely including all <area> tags inside
  cleanHtml = cleanHtml.replace(/<map[^>]*>[\s\S]*?<\/map>/gi, '');
  
  // 2. Remove usemap="..." attribute from <img> tags
  cleanHtml = cleanHtml.replace(/(<img[^>]+)usemap=["'][^"']*["']/gi, '$1');
  
  // 3. Remove <a> and </a> tags completely, but preserve their inner content (text or images)
  cleanHtml = cleanHtml.replace(/<\/?a[^>]*>/gi, '');
  
  return cleanHtml;
}

// Helper to clean a single field with retries
async function cleanSingleField(
  fieldName: string, 
  content: string, 
  placeholders: Map<string, string>,
  factSheet: FactSheet,
  options?: { removeSupplierInfo?: boolean, removeFAQ?: boolean, originalTitle?: string }
): Promise<{ cleaned: string, changes: string[] }> {
  if (!content || !content.trim()) return { cleaned: '', changes: [] };

  const MAX_RETRIES = 2;
  let lastError;

  let dynamicInstructions = "";
  dynamicInstructions += "\n- CRITICAL COMPLIANCE: You MUST identify and completely remove any text related to 'FDA', 'FDA Approved', 'FDA Certified', 'FDA Cleared', 'FDA Registered', or any FDA-related claims. Log this as '[FDA] Removed FDA claims'.";
  if (options?.removeSupplierInfo) {
    dynamicInstructions += "\n- CRITICAL: The user requested to REMOVE SUPPLIER INFO. You MUST identify and completely remove any sections related to 'About Us', 'Company Profile', 'Who we are', 'Factory Show', or any company introduction text/images. Log this as '[Company Info] Removed ...'.";
  }
  if (options?.removeFAQ) {
    dynamicInstructions += "\n- CRITICAL: The user requested to REMOVE FAQ. You MUST identify and completely remove any sections related to 'FAQ', 'Frequently Asked Questions', 'Q&A', or any list of questions and answers. Log this as '[FAQ] Removed ...'.";
  }
  if (options?.originalTitle) {
    dynamicInstructions += `\n- CRITICAL: You MUST identify and completely remove the original product title if it appears in the description text (especially at the top). Original Title to remove: "${options.originalTitle}". Also remove any existing bullet points that look like product highlights at the top. Log this as '[Title/Highlights] Removed original title/bullet points'.`;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('/api/opt/description/clean-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldName,
          content,
          factSheet,
          dynamicInstructions
        })
      });
      if (!res.ok) throw new Error(`Clean field failed (${res.status})`);
      const result = await res.json();
      return {
        cleaned: restoreImages(result.cleaned_html || '', placeholders),
        changes: result.changes_made || []
      };
    } catch (e: any) {
      console.warn(`Attempt ${attempt + 1} failed for ${fieldName}:`, e);
      lastError = e;
      // Wait before retry (exponential backoff: 1s, 2s, 4s)
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  // If all retries fail, return original content with error note
  return {
    cleaned: restoreImages(content, placeholders),
    changes: [`[Error] Failed to clean ${fieldName}: ${lastError.message}`]
  };
}

export async function cleanDescriptions(
  pc1: string, 
  pc2: string, 
  mobile1: string, 
  mobile2: string,
  factSheet: FactSheet,
  options?: { removeSupplierInfo?: boolean, removeFAQ?: boolean, originalTitle?: string }
): Promise<CleanedDescriptions> {
  // If all inputs are empty, return empty immediately
  if (!pc1 && !pc2 && !mobile1 && !mobile2) {
    return { pc1: '', pc2: '', mobile1: '', mobile2: '', changes: [] };
  }

  // 0. Strip external links (map, area, a tags)
  const cleanPc1 = stripExternalLinks(pc1 || '');
  const cleanPc2 = stripExternalLinks(pc2 || '');
  const cleanMobile1 = stripExternalLinks(mobile1 || '');
  const cleanMobile2 = stripExternalLinks(mobile2 || '');

  // 1. Strip Images (Global)
  // We strip images first to ensure placeholders are consistent
  const { stripped: sPc1, placeholders: pPc1 } = stripImages(cleanPc1);
  const { stripped: sPc2, placeholders: pPc2 } = stripImages(cleanPc2);
  const { stripped: sMobile1, placeholders: pMobile1 } = stripImages(cleanMobile1);
  const { stripped: sMobile2, placeholders: pMobile2 } = stripImages(cleanMobile2);

  try {
    // 2. Process fields in parallel (or sequential if rate limits are tight)
    // Using Promise.all for speed, but if rate limits hit, we might need sequential.
    // Gemini Flash has high rate limits, so parallel should be fine.
    
    const [resPc1, resPc2, resMobile1, resMobile2] = await Promise.all([
      cleanSingleField('PC Description 1', sPc1, pPc1, factSheet, options),
      cleanSingleField('PC Description 2', sPc2, pPc2, factSheet, options),
      cleanSingleField('Mobile Description 1', sMobile1, pMobile1, factSheet, options),
      cleanSingleField('Mobile Description 2', sMobile2, pMobile2, factSheet, options)
    ]);

    // 3. Aggregate results
    const allChanges = [
      ...resPc1.changes,
      ...resPc2.changes,
      ...resMobile1.changes,
      ...resMobile2.changes
    ];

    // Check if any critical errors occurred (optional: fail the whole process or just warn)
    const errors = allChanges.filter(c => c.startsWith('[Error]'));
    
    return {
      pc1: resPc1.cleaned,
      pc2: resPc2.cleaned,
      mobile1: resMobile1.cleaned,
      mobile2: resMobile2.cleaned,
      changes: allChanges,
      error: errors.length > 0 ? `部分字段清洗失败: ${errors.length} 个错误` : undefined
    };

  } catch (e: any) {
    console.error("Description cleaning failed:", e);
    return { 
      pc1: pc1, pc2: pc2, mobile1: mobile1, mobile2: mobile2, 
      changes: [],
      error: e.message || "Cleaning failed"
    };
  }
}
