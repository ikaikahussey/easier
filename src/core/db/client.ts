import path from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let instance: Promise<Db> | undefined;

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
    return drizzle({ client: new Pool({ connectionString: url }), schema }) as unknown as Db;
  }
  if (process.env.VERCEL) throw new Error("DATABASE_URL is required on Vercel");
  // Local development without Neon: embedded Postgres persisted in ./.pglite (or PGLITE_DIR).
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle({ client: new PGlite(process.env.PGLITE_DIR ?? path.join(process.cwd(), ".pglite")), schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  instance ??= connect();
  return instance;
}

/** Tests inject an isolated database. */
export function setDb(db: Db | undefined) {
  instance = db ? Promise.resolve(db) : undefined;
}

export interface Principal {
  userId: string;
  staff: boolean;
}

/**
 * Run client-data access as the restricted plainfirm_app role. Row-level security
 * then limits every statement to the principal's organizations (or, for staff, to
 * assigned engagements), regardless of the WHERE clauses the caller writes.
 */
export async function withTenant<T>(p: Principal, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role plainfirm_app`);
    await tx.execute(
      sql`select set_config('app.user_id', ${p.userId}, true), set_config('app.staff_user_id', ${p.staff ? p.userId : ""}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Privileged access (table owner, RLS bypassed). Restricted to authentication,
 * tenant provisioning, and reviewer assignment; never used to read client content.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}
