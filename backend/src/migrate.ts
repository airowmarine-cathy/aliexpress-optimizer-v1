import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

const MIGRATIONS: { id: string; filename: string }[] = [
  { id: "001_init", filename: "001_init.sql" },
  { id: "002_task_runs", filename: "002_task_runs.sql" }
];

export async function runMigrations(pool: Pool) {
  await pool.query(`
    create table if not exists _migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  for (const m of MIGRATIONS) {
    const already = await pool.query(`select 1 from _migrations where id=$1`, [
      m.id
    ]);
    if (already.rowCount && already.rowCount > 0) continue;

    const sqlPath = join(process.cwd(), "migrations", m.filename);
    const sql = readFileSync(sqlPath, "utf8");
    await pool.query("begin");
    try {
      await pool.query(sql);
      await pool.query(`insert into _migrations (id) values ($1)`, [m.id]);
      await pool.query("commit");
    } catch (e) {
      await pool.query("rollback");
      throw e;
    }
  }
}

