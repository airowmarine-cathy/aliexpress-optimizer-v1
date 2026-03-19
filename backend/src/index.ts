import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { createPool } from "./db.js";
import { ensureAdminBootstrap, requireAdmin, requireAuth, signToken, verifyPassword, hashPassword, type AuthedRequest } from "./auth.js";
import { runMigrations } from "./migrate.js";
import { getEnv } from "./env.js";

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

  const port = env.PORT || 8080;
  app.listen(port, "0.0.0.0", () => {
    console.log(`[ali-opt-api] listening on :${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

