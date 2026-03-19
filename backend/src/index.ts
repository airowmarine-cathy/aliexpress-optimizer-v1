import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { createPool } from "./db.js";
import { ensureAdminBootstrap, requireAdmin, requireAuth, signToken, verifyPassword, hashPassword, type AuthedRequest } from "./auth.js";
import { runMigrations } from "./migrate.js";
import { getEnv } from "./env.js";
import { runWithModelFallback } from "./opt/router.js";
import { FACT_SHEET_PROMPT_SYSTEM, SEO_PROMPT_SYSTEM, MARKETING_PROMPT_SYSTEM, ATTRIBUTE_PROMPT_SYSTEM, DESCRIPTION_PROMPT_SYSTEM } from "./opt/prompts.js";
import { attributesSchema, descriptionCleanFieldSchema, factSheetSchema, marketingSchema, seoSchema } from "./opt/schemas.js";

const env = getEnv();
const pool = createPool();

async function main() {
  await runMigrations(pool);
  await ensureAdminBootstrap(pool);

  const app = express();
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  const asyncRoute =
    (fn: (req: any, res: any) => Promise<any>) =>
    (req: any, res: any) => {
      fn(req, res).catch((e) => {
        if (e instanceof z.ZodError) {
          console.error("[route_error][zod]", JSON.stringify(e.issues));
        } else {
          console.error("[route_error]", e);
        }
        if (res.headersSent) return;
        res.status(500).json({ error: "Internal server error" });
      });
    };

  const asStringArray = (v: any): string[] => Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  const asRecordString = (v: any): Record<string, string> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) out[String(k)] = String(val ?? "");
    return out;
  };
  const hasValue = (v: any) => {
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  };
  const collectMissingFields = (obj: any, requiredKeys: string[]) =>
    requiredKeys.filter((k) => !hasValue(obj?.[k]));
  const normalizeCategory = (v: any) => {
    const s = String(v ?? "");
    return ["Industrial", "Productivity", "Home", "Fashion", "Outdoor"].includes(s) ? s : "Industrial";
  };

  // Login with username/password.
  app.post("/api/auth/login", async (req, res) => {
    const bodySchema = z.object({
      username: z.string().min(1),
      password: z.string().min(1)
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const { username, password } = parsed.data;
    const userRes = await pool.query(
      `select id, username, password_hash, role from users where username=$1`,
      [username]
    );
    const row = userRes.rows[0];
    if (!row) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken({ id: row.id, username: row.username, role: row.role });
    return res.json({ token, user: { id: row.id, username: row.username, role: row.role } });
  });

  // Who am I
  app.get("/api/auth/me", requireAuth, async (req: AuthedRequest, res) => {
    return res.json({ user: req.user });
  });

  // Admin: create user
  app.post("/api/admin/users", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const bodySchema = z.object({
      username: z.string().min(1).max(64),
      password: z.string().min(10).max(128),
      role: z.enum(["admin", "user"]).default("user")
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const { username, password, role } = parsed.data;
    const passwordHash = await hashPassword(password);
    try {
      const inserted = await pool.query(
        `insert into users (username, password_hash, role) values ($1, $2, $3) returning id, username, role, created_at`,
        [username, passwordHash, role]
      );
      await pool.query(
        `insert into audit_log (actor_user_id, action, details) values ($1, 'user.create', $2)`,
        [req.user!.id, { username, role }]
      );
      return res.status(201).json({ user: inserted.rows[0] });
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("users_username_key")) {
        return res.status(409).json({ error: "Username already exists" });
      }
      return res.status(500).json({ error: "Server error" });
    }
  });

  // Admin: list users
  app.get("/api/admin/users", requireAuth, requireAdmin, async (_req: AuthedRequest, res) => {
    const users = await pool.query(
      `select id, username, role, created_at, updated_at from users order by created_at desc`
    );
    return res.json({ users: users.rows });
  });

  // Admin: reset password
  app.post("/api/admin/users/:userId/reset-password", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const paramsSchema = z.object({ userId: z.string().uuid() });
    const bodySchema = z.object({ newPassword: z.string().min(10).max(128) });
    const params = paramsSchema.safeParse(req.params);
    const body = bodySchema.safeParse(req.body);
    if (!params.success || !body.success) return res.status(400).json({ error: "Bad request" });

    const passwordHash = await hashPassword(body.data.newPassword);
    const updated = await pool.query(
      `update users set password_hash=$1, updated_at=now() where id=$2 returning id, username, role`,
      [passwordHash, params.data.userId]
    );
    if ((updated.rowCount || 0) === 0) return res.status(404).json({ error: "Not found" });
    await pool.query(
      `insert into audit_log (actor_user_id, action, details) values ($1, 'user.reset_password', $2)`,
      [req.user!.id, { userId: params.data.userId }]
    );
    return res.json({ ok: true });
  });

  // --- Optimization (Text Steps) ---
  // These endpoints replace frontend direct model calls.
  // They also record token usage & estimated cost into DB.

  const recordUsage = async (args: {
    ownerUserId: string;
    step: string;
    modelId: string;
    inputTokens?: number;
    outputTokens?: number;
    costCny?: number | null;
    meta?: any;
  }) => {
    await pool.query(
      `insert into usage_records (owner_user_id, step, provider, model_id, input_tokens, output_tokens, cost_cny, meta)
       values ($1,$2,'ark',$3,$4,$5,$6,$7)`,
      [
        args.ownerUserId,
        args.step,
        args.modelId,
        args.inputTokens ?? null,
        args.outputTokens ?? null,
        args.costCny ?? null,
        args.meta ?? {}
      ]
    );
  };

  app.post("/api/opt/factsheet", requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const bodySchema = z.object({
      title: z.string(),
      customAttributes: z.any(),
      descriptionHtml: z.string()
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const { title, customAttributes, descriptionHtml } = parsed.data;
    const attributesStr = typeof customAttributes === "string" ? customAttributes : JSON.stringify(customAttributes, null, 2);

    const models = ["doubao-seed-2-0-pro-260215", "deepseek-v3-2-251201"];

    let missingFields: string[] = [];
    const { result, attempt } = await runWithModelFallback({
      models,
      responseFormatJson: true,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: FACT_SHEET_PROMPT_SYSTEM },
        {
          role: "user",
          content: `Original Title: ${title}\n\nCustom Attributes: ${attributesStr}\n\nDescription HTML:\n${descriptionHtml}\n\nReturn JSON only.`
        }
      ],
      validate: (obj) => {
        missingFields = collectMissingFields(obj, [
          "material",
          "dimensions",
          "technical_specs",
          "certifications",
          "suggested_keywords",
          "category_matrix",
          "compatibility"
        ]);
        const safeObj = {
          material: String(obj?.material ?? ""),
          dimensions: String(obj?.dimensions ?? ""),
          technical_specs: asRecordString(obj?.technical_specs),
          certifications: asStringArray(obj?.certifications),
          suggested_keywords: asStringArray(obj?.suggested_keywords),
          category_matrix: normalizeCategory(obj?.category_matrix),
          compatibility: asStringArray(obj?.compatibility)
        };
        return factSheetSchema.parse(safeObj);
      }
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "factSheet",
      modelId: attempt.modelId,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: attempt.costCny,
      meta: { json_mode: attempt.jsonMode, missing_fields: missingFields }
    });

    return res.json(result);
  }));

  app.post("/api/opt/seo-title", requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const bodySchema = z.object({
      factSheet: z.any(),
      originalTitle: z.string()
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const models = ["doubao-seed-2-0-pro-260215", "deepseek-v3-2-251201"];

    let missingFields: string[] = [];
    const { result, attempt } = await runWithModelFallback({
      models,
      responseFormatJson: true,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: SEO_PROMPT_SYSTEM },
        {
          role: "user",
          content: `Original Title: ${parsed.data.originalTitle}\n\nFact Sheet: ${JSON.stringify(parsed.data.factSheet)}\n\nReturn JSON only.`
        }
      ],
      validate: (obj) => {
        missingFields = collectMissingFields(obj, [
          "optimized_title",
          "character_count",
          "core_keywords_embedded",
          "modification_reasons"
        ]);
        const parsedObj = seoSchema.parse({
          optimized_title: String(obj?.optimized_title ?? parsed.data.originalTitle),
          character_count: Number(obj?.character_count ?? 0),
          core_keywords_embedded: asStringArray(obj?.core_keywords_embedded),
          modification_reasons: String(obj?.modification_reasons ?? "模型未返回优化原因")
        });
        // Hard guard: keep title length within spec, else treat as invalid to trigger fallback.
        const len = parsedObj.optimized_title?.length ?? 0;
        if (len < 30) throw new Error(`SEO title too short: ${len}`);
        parsedObj.character_count = len;
        return parsedObj;
      }
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "seoTitle",
      modelId: attempt.modelId,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: attempt.costCny,
      meta: { json_mode: attempt.jsonMode, missing_fields: missingFields }
    });

    return res.json(result);
  }));

  app.post("/api/opt/marketing", requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const bodySchema = z.object({ factSheet: z.any() });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const models = ["doubao-seed-2-0-pro-260215", "deepseek-v3-2-251201"];

    let missingFields: string[] = [];
    const { result, attempt } = await runWithModelFallback({
      models,
      responseFormatJson: true,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: MARKETING_PROMPT_SYSTEM },
        { role: "user", content: `Fact Sheet: ${JSON.stringify(parsed.data.factSheet)}\n\nReturn JSON only.` }
      ],
      validate: (obj) => {
        missingFields = collectMissingFields(obj, ["category_matrix", "points"]);
        const m = marketingSchema.parse({
          category_matrix: normalizeCategory(obj?.category_matrix),
          points: Array.isArray(obj?.points)
            ? obj.points.map((p: any) => ({ header: String(p?.header ?? ""), content: String(p?.content ?? "") }))
            : []
        });
        if (m.points.length === 0) throw new Error("Marketing points missing");
        return m;
      }
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "marketing",
      modelId: attempt.modelId,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: attempt.costCny,
      meta: { json_mode: attempt.jsonMode, missing_fields: missingFields }
    });

    return res.json(result);
  }));

  app.post("/api/opt/attributes", requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const bodySchema = z.object({
      originalAttributes: z.string(),
      factSheet: z.any()
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const models = ["doubao-seed-2-0-pro-260215", "deepseek-v3-2-251201"];

    let missingFields: string[] = [];
    const { result, attempt } = await runWithModelFallback({
      models,
      responseFormatJson: true,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: ATTRIBUTE_PROMPT_SYSTEM },
        {
          role: "user",
          content: `Original Attributes: ${parsed.data.originalAttributes}\n\nFact Sheet Data: ${JSON.stringify(parsed.data.factSheet, null, 2)}\n\nReturn JSON only.`
        }
      ],
      validate: (obj) => {
        missingFields = collectMissingFields(obj, ["optimized_string", "changes_made"]);
        return attributesSchema.parse({
          optimized_string: String(obj?.optimized_string ?? ""),
          changes_made: asStringArray(obj?.changes_made)
        });
      }
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "attributes",
      modelId: attempt.modelId,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: attempt.costCny,
      meta: { json_mode: attempt.jsonMode, missing_fields: missingFields }
    });

    return res.json({
      optimized: result.optimized_string || parsed.data.originalAttributes,
      changes: result.changes_made || []
    });
  }));

  app.post("/api/opt/description/clean-field", requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const bodySchema = z.object({
      fieldName: z.string(),
      content: z.string(),
      factSheet: z.any(),
      dynamicInstructions: z.string().optional()
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const models = ["doubao-seed-2-0-pro-260215", "doubao-seed-2-0-lite-260215"];

    const dyn = parsed.data.dynamicInstructions ? `\nDynamic Instructions:\n${parsed.data.dynamicInstructions}\n` : "";

    let missingFields: string[] = [];
    const { result, attempt } = await runWithModelFallback({
      models,
      responseFormatJson: true,
      timeoutMs: 120_000,
      messages: [
        { role: "system", content: DESCRIPTION_PROMPT_SYSTEM },
        {
          role: "user",
          content: `Task: Clean the following ${parsed.data.fieldName} HTML content.\n\nFact Sheet Data:\n${JSON.stringify(parsed.data.factSheet, null, 2)}\n${dyn}\nContent:\n${parsed.data.content}\n\nReturn JSON only.`
        }
      ],
      validate: (obj) => {
        missingFields = collectMissingFields(obj, ["cleaned_html", "changes_made"]);
        return descriptionCleanFieldSchema.parse({
          cleaned_html: String(obj?.cleaned_html ?? ""),
          changes_made: asStringArray(obj?.changes_made)
        });
      }
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "description",
      modelId: attempt.modelId,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: attempt.costCny,
      meta: {
        fieldName: parsed.data.fieldName,
        json_mode: attempt.jsonMode,
        missing_fields: missingFields
      }
    });

    return res.json(result);
  }));

  const port = env.PORT || 8080;
  app.listen(port, "0.0.0.0", () => {
    console.log(`[ali-opt-api] listening on :${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

