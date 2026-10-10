import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/core/db/schema";
import { setDb, type Db } from "@/core/db/client";
import { configureServices, type Actor } from "@/core/services/context";
import type { Role } from "@/core/workflow";
import type { NonprofitRegistry } from "@/core/connectors/nonprofit-registry";

process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

export async function freshDb(registry?: NonprofitRegistry): Promise<Db> {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  setDb(db as unknown as Db);
  configureServices({ llm: undefined, registry: registry ?? { lookup: async () => undefined } });
  return db as unknown as Db;
}

export async function makeUser(db: Db, email: string, role: Role = "client"): Promise<Actor> {
  const [u] = await db.insert(schema.users).values({ email, role }).returning();
  return { id: u!.id, email: u!.email, role };
}
