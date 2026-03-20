import pg from "pg";
import { getEnv } from "./env.js";

const { Pool } = pg;

export function createPool() {
  const env = getEnv();
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 8000,  // fail fast if pool is exhausted
    idleTimeoutMillis: 30000,
    statement_timeout: 20000        // 20s max per query
  });
}

export type DbPool = ReturnType<typeof createPool>;

