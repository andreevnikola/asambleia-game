// Applies db/schema.sql to Neon. Uses the direct (unpooled) DATABASE_URL.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

try {
  process.loadEnvFile(".env");
} catch {
  // env may already be provided by the shell / CI
}

const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_POOLED;
if (!url) {
  console.error("Липсва DATABASE_URL.");
  process.exit(1);
}

const sql = neon(url);
const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(/;\s*(?:\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);

for (const stmt of statements) {
  await sql.query(stmt);
}
const [{ n }] = await sql.query("SELECT count(*)::int AS n FROM game");
console.log(`OK: ${statements.length} statements applied, game rows: ${n}`);
