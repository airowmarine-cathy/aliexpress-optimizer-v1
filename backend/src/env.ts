import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().optional(),

  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(20),

  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_INITIAL_PASSWORD: z.string().min(10).optional(),

  // These will be used later when we switch model calls to backend.
  ARK_API_KEY: z.string().min(1).optional(),
  IMGBB_API_KEY: z.string().min(1).optional(),
  GOOGLE_SHEETS_URL: z.string().min(1).optional()
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n${parsed.error.issues
        .map((i) => `- ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`
    );
  }
  return parsed.data;
}

