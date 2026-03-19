import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Type } from "@google/genai";
import { z } from "zod";
import { createPool } from "./db.js";
import { ensureAdminBootstrap, requireAdmin, requireAuth, signToken, verifyPassword, hashPassword, type AuthedRequest } from "./auth.js";
import { runMigrations } from "./migrate.js";
import { getEnv } from "./env.js";
import { runGeminiWithFallback } from "./gemini/client.js";
import { estimateGeminiCostCny } from "./gemini/pricing.js";
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

  // Keep parity with original server.ts image proxy capability.
  // This endpoint is critical for fetching external images (e.g., 店小秘 links)
  // from the server side to avoid browser CORS/mixed-content limitations.
  app.get("/api/fetch-image", async (req, res) => {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).send("Missing url parameter");

    const tryFetch = async (u: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        return await fetch(u, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://www.dianxiaomi.com/"
          }
        });
      } finally {
        clearTimeout(timer);
      }
    };

    const candidates = [url];
    if (url.startsWith("http://")) candidates.push(url.replace(/^http:\/\//i, "https://"));
    if (url.startsWith("https://")) candidates.push(url.replace(/^https:\/\//i, "http://"));

    let lastStatus = 500;
    let lastMessage = "Failed to fetch image";

    for (const candidate of candidates) {
      try {
        const response = await tryFetch(candidate);
        lastStatus = response.status;
        if (!response.ok) {
          lastMessage = `Upstream status ${response.status}`;
          continue;
        }

        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Some upstreams return XML/HTML error pages with 200 status.
        // Reject non-image payloads so caller can fallback to other links.
        if (!contentType.startsWith("image/")) {
          const preview = buffer.toString("utf8", 0, 200).trim();
          lastStatus = 415;
          lastMessage = `Unsupported MIME type: ${contentType || "unknown"}; preview=${preview}`;
          continue;
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(buffer);
      } catch (e: any) {
        lastStatus = 500;
        lastMessage = e?.message || "Unknown fetch error";
      }
    }

    console.error("[fetch_image_error]", { url, lastStatus, lastMessage });
    return res.status(lastStatus).send(`Error fetching image: ${lastMessage}`);
  });

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

  const FACT_SHEET_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      material: { type: Type.STRING },
      dimensions: { type: Type.STRING },
      technical_specs: { type: Type.OBJECT, additionalProperties: { type: Type.STRING } },
      certifications: { type: Type.ARRAY, items: { type: Type.STRING } },
      suggested_keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
      category_matrix: { type: Type.STRING, enum: ["Industrial", "Productivity", "Home", "Fashion", "Outdoor"] },
      compatibility: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ["material", "dimensions", "technical_specs", "certifications", "suggested_keywords", "category_matrix", "compatibility"]
  };
  const SEO_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      optimized_title: { type: Type.STRING },
      character_count: { type: Type.INTEGER },
      core_keywords_embedded: { type: Type.ARRAY, items: { type: Type.STRING } },
      modification_reasons: { type: Type.STRING }
    },
    required: ["optimized_title", "character_count", "core_keywords_embedded", "modification_reasons"]
  };
  const MARKETING_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      category_matrix: { type: Type.STRING, enum: ["Industrial", "Productivity", "Home", "Fashion", "Outdoor"] },
      points: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { header: { type: Type.STRING }, content: { type: Type.STRING } },
          required: ["header", "content"]
        }
      }
    },
    required: ["category_matrix", "points"]
  };
  const ATTRIBUTE_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      optimized_string: { type: Type.STRING },
      changes_made: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ["optimized_string", "changes_made"]
  };
  const DESCRIPTION_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      cleaned_html: { type: Type.STRING },
      changes_made: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ["cleaned_html", "changes_made"]
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
    await pool.query(
      `insert into audit_log (actor_user_id, action, details) values ($1, 'auth.login', $2)`,
      [row.id, { username: row.username }]
    );
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

  // Client-side user actions that should appear in admin audit.
  app.post("/api/audit/client-event", requireAuth, async (req: AuthedRequest, res) => {
    const bodySchema = z.object({
      action: z.string().min(1).max(80),
      details: z.record(z.string(), z.any()).optional()
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    await pool.query(
      `insert into audit_log (actor_user_id, action, details) values ($1, $2, $3)`,
      [req.user!.id, parsed.data.action, parsed.data.details ?? {}]
    );
    return res.json({ ok: true });
  });

  app.get("/api/admin/usage/summary", requireAuth, requireAdmin, asyncRoute(async (req: AuthedRequest, res) => {
    const querySchema = z.object({
      days: z.coerce.number().int().min(1).max(365).default(30),
      userId: z.string().uuid().optional()
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const { days, userId } = parsed.data;
    const params: (string | null)[] = [String(days), userId ?? null];

    const totals = await pool.query(
      `select
         count(*)::int as total_calls,
         coalesce(sum(input_tokens), 0)::int as total_input_tokens,
         coalesce(sum(output_tokens), 0)::int as total_output_tokens,
         coalesce(sum(cost_cny), 0)::numeric as total_cost_cny
       from usage_records
       where created_at >= now() - ($1::text || ' days')::interval
         and ($2::uuid is null or owner_user_id = $2::uuid)`,
      params
    );

    const byStep = await pool.query(
      `select step,
              count(*)::int as calls,
              coalesce(sum(input_tokens), 0)::int as input_tokens,
              coalesce(sum(output_tokens), 0)::int as output_tokens,
              coalesce(sum(cost_cny), 0)::numeric as cost_cny
       from usage_records
       where created_at >= now() - ($1::text || ' days')::interval
         and ($2::uuid is null or owner_user_id = $2::uuid)
       group by step
       order by calls desc, step asc`,
      params
    );

    const byModel = await pool.query(
      `select model_id,
              count(*)::int as calls,
              coalesce(sum(input_tokens), 0)::int as input_tokens,
              coalesce(sum(output_tokens), 0)::int as output_tokens,
              coalesce(sum(cost_cny), 0)::numeric as cost_cny
       from usage_records
       where created_at >= now() - ($1::text || ' days')::interval
         and ($2::uuid is null or owner_user_id = $2::uuid)
       group by model_id
       order by calls desc, model_id asc`,
      params
    );

    const byUser = await pool.query(
      `select coalesce(u.username, 'unknown') as username,
              ur.owner_user_id,
              count(*)::int as calls,
              coalesce(sum(ur.input_tokens), 0)::int as input_tokens,
              coalesce(sum(ur.output_tokens), 0)::int as output_tokens,
              coalesce(sum(ur.cost_cny), 0)::numeric as cost_cny
       from usage_records ur
       left join users u on u.id = ur.owner_user_id
       where ur.created_at >= now() - ($1::text || ' days')::interval
         and ($2::uuid is null or ur.owner_user_id = $2::uuid)
       group by u.username, ur.owner_user_id
       order by calls desc, username asc`,
      params
    );

    return res.json({
      days,
      totals: totals.rows[0],
      byStep: byStep.rows,
      byModel: byModel.rows,
      byUser: byUser.rows
    });
  }));

  app.get("/api/admin/usage/list", requireAuth, requireAdmin, asyncRoute(async (req: AuthedRequest, res) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      userId: z.string().uuid().optional()
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const { limit, userId } = parsed.data;
    const rows = await pool.query(
      `select ur.id,
              ur.created_at,
              ur.step,
              ur.provider,
              ur.model_id,
              ur.input_tokens,
              ur.output_tokens,
              ur.cost_cny,
              ur.meta,
              ur.owner_user_id,
              coalesce(u.username, 'unknown') as username
       from usage_records ur
       left join users u on u.id = ur.owner_user_id
       where ($2::uuid is null or ur.owner_user_id = $2::uuid)
       order by ur.created_at desc
       limit $1`,
      [limit, userId ?? null]
    );
    return res.json({ records: rows.rows });
  }));

  app.get("/api/admin/audit/list", requireAuth, requireAdmin, asyncRoute(async (req: AuthedRequest, res) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      userId: z.string().uuid().optional(),
      days: z.coerce.number().int().min(1).max(365).optional()
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const { limit, userId, days } = parsed.data;
    const rows = await pool.query(
      `select al.id,
              al.action,
              al.details,
              al.created_at,
              al.actor_user_id,
              coalesce(u.username, 'unknown') as username
       from audit_log al
       left join users u on u.id = al.actor_user_id
       where ($2::uuid is null or al.actor_user_id = $2::uuid)
         and ($3::int is null or al.created_at >= now() - ($3::text || ' days')::interval)
       order by al.created_at desc
       limit $1`,
      [limit, userId ?? null, days ?? null]
    );
    return res.json({ records: rows.rows });
  }));

  app.get("/api/admin/usage/daily", requireAuth, requireAdmin, asyncRoute(async (req: AuthedRequest, res) => {
    const querySchema = z.object({
      days: z.coerce.number().int().min(1).max(365).default(30),
      userId: z.string().uuid().optional()
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const { days, userId } = parsed.data;
    const rows = await pool.query(
      `select
         to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as date,
         count(*)::int as calls,
         coalesce(sum(input_tokens), 0)::int as input_tokens,
         coalesce(sum(output_tokens), 0)::int as output_tokens,
         coalesce(sum(cost_cny), 0)::numeric as cost_cny
       from usage_records
       where created_at >= now() - ($1::text || ' days')::interval
         and ($2::uuid is null or owner_user_id = $2::uuid)
       group by date_trunc('day', created_at at time zone 'UTC')
       order by date asc`,
      [String(days), userId ?? null]
    );
    return res.json({ records: rows.rows });
  }));

  app.get("/api/admin/tasks/list", requireAuth, requireAdmin, asyncRoute(async (req: AuthedRequest, res) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      userId: z.string().uuid().optional(),
      days: z.coerce.number().int().min(1).max(365).optional()
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const { limit, userId, days } = parsed.data;
    const jobRows = await pool.query(
      `select j.id,
              'job' as source,
              j.status,
              j.filename,
              j.total_items,
              j.created_at,
              j.updated_at,
              j.owner_user_id,
              coalesce(u.username, 'unknown') as username,
              null::jsonb as details
       from jobs j
       left join users u on u.id = j.owner_user_id
       where ($2::uuid is null or j.owner_user_id = $2::uuid)
         and ($3::int is null or j.created_at >= now() - ($3::text || ' days')::interval)
       order by j.created_at desc
       limit $1`,
      [limit, userId ?? null, days ?? null]
    );

    const eventRows = await pool.query(
      `select al.id,
              'event' as source,
              al.action as status,
              coalesce(al.details->>'filename', '') as filename,
              coalesce((al.details->>'itemCount')::int, 0) as total_items,
              al.created_at,
              al.created_at as updated_at,
              al.actor_user_id as owner_user_id,
              coalesce(u.username, 'unknown') as username,
              al.details
       from audit_log al
       left join users u on u.id = al.actor_user_id
       where al.action in ('products.upload', 'products.export')
         and ($2::uuid is null or al.actor_user_id = $2::uuid)
         and ($3::int is null or al.created_at >= now() - ($3::text || ' days')::interval)
       order by al.created_at desc
       limit $1`,
      [limit, userId ?? null, days ?? null]
    );

    const records = [...eventRows.rows, ...jobRows.rows]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    return res.json({ records });
  }));

  // --- Optimization (Text Steps) ---
  // These endpoints replace frontend direct model calls.
  // They also record token usage & estimated cost into DB.

  const recordUsage = async (args: {
    ownerUserId: string;
    step: string;
    provider?: "gemini" | "ark";
    modelId: string;
    inputTokens?: number;
    outputTokens?: number;
    costCny?: number | null;
    meta?: any;
  }) => {
    await pool.query(
      `insert into usage_records (owner_user_id, step, provider, model_id, input_tokens, output_tokens, cost_cny, meta)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        args.ownerUserId,
        args.step,
        args.provider ?? "gemini",
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

    const models = ["gemini-3-flash-preview"];
    const { result, attempt } = await runGeminiWithFallback({
      models,
      systemInstruction: FACT_SHEET_PROMPT_SYSTEM,
      userContent: `你是一个专业的产品数据专家。请从以下三个维度深度解析并提取产品事实清单（Fact Sheet）：
        
1. 原始标题 (Original Title): ${title}
2. 自定义属性 (Custom Attributes): ${attributesStr}
3. 产品详细描述 (Description HTML): 
${descriptionHtml}

【核心路径（Primary）】：
利用 Gemini 3.1 Pro 的长文本理解能力，深度解析“产品详细描述 (HTML)”和“原始标题”。
从复杂的 HTML 标签（尤其是 <table>, <ul>, <ol>）中剥离出材质、规格、技术参数等硬核数据。

【提取规则】：
- 优先级：自定义属性 > 详细描述中的表格/列表 > 原始标题。
- 目标：提取材质 (Material)、规格尺寸 (Dimensions)、技术参数 (Technical Specs)、认证信息 (Certifications)。
- 排除：品牌名、型号、营销话术、保修/售后信息。
- 语言：所有输出必须使用专业、地道的电商英文。`,
      responseSchema: FACT_SHEET_RESPONSE_SCHEMA,
      validate: (obj) => factSheetSchema.parse(obj)
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "factSheet",
      modelId: attempt.modelId,
      provider: "gemini",
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: estimateGeminiCostCny(attempt.modelId, attempt.inputTokens, attempt.outputTokens),
      meta: { json_mode: attempt.jsonMode }
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

    const models = ["gemini-3-flash-preview"];
    const { result, attempt } = await runGeminiWithFallback({
      models,
      systemInstruction: SEO_PROMPT_SYSTEM,
      userContent: `Original Title: ${parsed.data.originalTitle}\n\nFact Sheet: ${JSON.stringify(parsed.data.factSheet)}\n\nReturn JSON only.`,
      responseSchema: SEO_RESPONSE_SCHEMA,
      validate: (obj) => {
        const parsedObj = seoSchema.parse(obj);
        const len = parsedObj.optimized_title?.length ?? 0;
        if (len < 110 || len > 128) throw new Error(`SEO title length out of range: ${len}`);
        parsedObj.character_count = len;
        return parsedObj;
      }
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "seoTitle",
      modelId: attempt.modelId,
      provider: "gemini",
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: estimateGeminiCostCny(attempt.modelId, attempt.inputTokens, attempt.outputTokens),
      meta: { json_mode: attempt.jsonMode }
    });

    return res.json(result);
  }));

  app.post("/api/opt/marketing", requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
    const bodySchema = z.object({ factSheet: z.any() });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bad request" });

    const models = ["gemini-3-flash-preview"];
    const { result, attempt } = await runGeminiWithFallback({
      models,
      systemInstruction: MARKETING_PROMPT_SYSTEM,
      userContent: `Fact Sheet: ${JSON.stringify(parsed.data.factSheet)}\n\nReturn JSON only.`,
      responseSchema: MARKETING_RESPONSE_SCHEMA,
      validate: (obj) => {
        const m = marketingSchema.parse(obj);
        if (m.points.length < 3 || m.points.length > 5) throw new Error("Marketing points must be 3-5");
        return m;
      }
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "marketing",
      modelId: attempt.modelId,
      provider: "gemini",
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: estimateGeminiCostCny(attempt.modelId, attempt.inputTokens, attempt.outputTokens),
      meta: { json_mode: attempt.jsonMode }
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

    const models = ["gemini-3-flash-preview"];
    const { result, attempt } = await runGeminiWithFallback({
      models,
      systemInstruction: ATTRIBUTE_PROMPT_SYSTEM,
      userContent: `Original Attributes: ${parsed.data.originalAttributes}\n\nFact Sheet Data: ${JSON.stringify(parsed.data.factSheet, null, 2)}\n\nReturn JSON only.`,
      responseSchema: ATTRIBUTE_RESPONSE_SCHEMA,
      validate: (obj) => attributesSchema.parse(obj)
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "attributes",
      modelId: attempt.modelId,
      provider: "gemini",
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: estimateGeminiCostCny(attempt.modelId, attempt.inputTokens, attempt.outputTokens),
      meta: { json_mode: attempt.jsonMode }
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

    const models = ["gemini-3-flash-preview"];

    const dyn = parsed.data.dynamicInstructions ? `\nDynamic Instructions:\n${parsed.data.dynamicInstructions}\n` : "";

    const { result, attempt } = await runGeminiWithFallback({
      models,
      systemInstruction: DESCRIPTION_PROMPT_SYSTEM,
      userContent: `Task: Clean the following ${parsed.data.fieldName} HTML content.\n\nFact Sheet Data:\n${JSON.stringify(parsed.data.factSheet, null, 2)}\n${dyn}\nContent:\n${parsed.data.content}\n\nReturn JSON only.`,
      responseSchema: DESCRIPTION_RESPONSE_SCHEMA,
      validate: (obj) => descriptionCleanFieldSchema.parse(obj)
    });

    await recordUsage({
      ownerUserId: req.user!.id,
      step: "description",
      modelId: attempt.modelId,
      provider: "gemini",
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costCny: estimateGeminiCostCny(attempt.modelId, attempt.inputTokens, attempt.outputTokens),
      meta: {
        fieldName: parsed.data.fieldName,
        json_mode: attempt.jsonMode
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

