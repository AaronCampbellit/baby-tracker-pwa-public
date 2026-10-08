import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(191916)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY)",
    );
    for (const name of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (await client.query("SELECT 1 FROM migrations WHERE name=$1", [name]))
          .rowCount
      )
        continue;
      await client.query(
        await readFile(
          new URL("../migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
      await client.query("INSERT INTO migrations(name) VALUES($1)", [name]);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(191916)");
    client.release();
  }
}
export async function transaction<T>(
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const v = await fn(c);
    await c.query("COMMIT");
    return v;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
