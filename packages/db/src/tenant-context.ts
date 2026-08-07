import { sql } from "drizzle-orm";
import { db } from "./client";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTenant<T>(
  accountId: string,
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant_id', ${accountId}, true)`);
    return callback(tx);
  });
}
