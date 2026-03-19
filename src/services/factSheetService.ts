import { apiFetch } from "../auth/api";

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
- EXTRACT: Material, Dimensions/Size, Technical Specifications (Power, Capacity, Interface, etc.), and Certifications (CE, RoHS, etc.).
- CRITICAL COMPLIANCE: You MUST completely IGNORE and EXCLUDE any mentions of "FDA", "FDA Approved", "FDA Certified", "FDA Cleared", "FDA Registered", or any FDA-related claims. Do not extract them into certifications or anywhere else.
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

// Kept for compatibility with existing code references (schema enforcement is now on backend).
export const FACT_SHEET_SCHEMA = {};

export async function extractFactSheet(title: string, customAttributes: any, descriptionHtml: string): Promise<FactSheet> {
  // Deep Parsing: keep more HTML structure for model to analyze
  const prepareContent = (html: string) => {
    if (!html) return "No description available.";
    // Remove scripts, styles, and other non-content tags
    let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
                      .replace(/<img[^>]*>/gi, '')
                      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
    
    // Strip all HTML tags except for structural ones like tables and lists
    // This helps the Flash model focus on the data without getting confused by complex DOM trees
    cleaned = cleaned.replace(/<\/?(?!(table|tr|td|th|tbody|thead|ul|ol|li|p|br)\b)[^>]+>/gi, ' ');
    
    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // Return the fully cleaned description without arbitrary truncation
    // to ensure no product information is lost.
    return cleaned;
  };

  const richDescription = prepareContent(descriptionHtml);
  return await apiFetch<FactSheet>('/api/opt/factsheet', {
    method: 'POST',
    body: JSON.stringify({
      title,
      customAttributes,
      descriptionHtml: richDescription
    })
  });
}
