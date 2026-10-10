/** Apply SQL migrations to Neon during the Vercel build. Skips when no database is configured. */
import path from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.warn("[migrate] DATABASE_URL not set; skipping migrations");
  process.exit(0);
}
if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
const pool = new Pool({ connectionString: url });
await migrate(drizzle({ client: pool }), { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
await pool.end();
console.log("[migrate] migrations applied");
