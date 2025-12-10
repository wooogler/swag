import { Database } from "bun:sqlite";
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Ensure data directory exists
const dbPath = process.env.DATABASE_URL?.replace('file:', '') || "./data/prelude.db";
try {
  mkdirSync(dirname(dbPath), { recursive: true });
} catch (err) {
  // Directory might already exist
}

// Create SQLite connection with Bun
const sqlite = new Database(dbPath, {
  create: true,
});

// Enable WAL mode for better performance
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA synchronous = NORMAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });
export { sqlite };
