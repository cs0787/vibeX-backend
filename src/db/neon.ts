import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL || '';

export const sql = databaseUrl ? neon(databaseUrl) : null;

export async function queryNeon(text: string, params: any[] = []) {
  if (!sql) {
    console.warn("Neon DATABASE_URL is not set. Operating in in-memory mode.");
    return null;
  }
  try {
    return await sql(text, params);
  } catch (err) {
    console.error("Neon DB Query error:", err);
    return null;
  }
}
