import { z } from "zod";

export const factSheetSchema = z.object({
  material: z.string(),
  dimensions: z.string(),
  technical_specs: z.record(z.string(), z.string()),
  certifications: z.array(z.string()),
  suggested_keywords: z.array(z.string()),
  category_matrix: z.enum(["Industrial", "Productivity", "Home", "Fashion", "Outdoor"]),
  compatibility: z.array(z.string()).optional().default([])
});

export const seoSchema = z.object({
  optimized_title: z.string(),
  character_count: z.number().int(),
  core_keywords_embedded: z.array(z.string()),
  modification_reasons: z.string()
});

export const marketingSchema = z.object({
  category_matrix: z.enum(["Industrial", "Productivity", "Home", "Fashion", "Outdoor"]),
  points: z.array(
    z.object({
      header: z.string(),
      content: z.string()
    })
  )
});

export const attributesSchema = z.object({
  optimized_string: z.string(),
  changes_made: z.array(z.string())
});

export const descriptionCleanFieldSchema = z.object({
  cleaned_html: z.string(),
  changes_made: z.array(z.string())
});

