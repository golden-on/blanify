import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString =
  process.env.APP_DATABASE_URL ??
  "postgresql://app_user:AppUser2026DbAccessBlanify@localhost:5432/blanify";

export const client = postgres(connectionString);
export const db = drizzle(client, { schema });
