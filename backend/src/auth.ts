import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { getEnv } from "./env.js";

export type User = {
  id: string;
  username: string;
  role: "admin" | "user";
};

export async function hashPassword(password: string) {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signToken(user: User) {
  const env = getEnv();
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

const tokenPayloadSchema = z.object({
  sub: z.string(),
  username: z.string(),
  role: z.enum(["admin", "user"])
});

export type AuthedRequest = Request & { user?: User };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const [, token] = header.split(" ");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const env = getEnv();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const parsed = tokenPayloadSchema.safeParse(decoded);
    if (!parsed.success) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: parsed.data.sub, username: parsed.data.username, role: parsed.data.role };
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
}

export async function ensureAdminBootstrap(pool: Pool) {
  const env = getEnv();
  const existing = await pool.query(
    `select id, username, role from users where role='admin' limit 1`
  );
  if ((existing.rowCount || 0) > 0) return;

  if (!env.ADMIN_INITIAL_PASSWORD) {
    // We refuse to auto-create an admin without a password, to avoid surprises.
    return;
  }

  const passwordHash = await hashPassword(env.ADMIN_INITIAL_PASSWORD);
  await pool.query(
    `insert into users (username, password_hash, role) values ($1, $2, 'admin')`,
    [env.ADMIN_USERNAME, passwordHash]
  );
}

