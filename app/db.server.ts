import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../drizzle/schema';

export type DrizzleDb = ReturnType<typeof drizzle>;

export function getDb(d1: D1Database): DrizzleDb {
  return drizzle(d1, { schema });
}


