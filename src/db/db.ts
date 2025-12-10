import { sql as vercelSql } from '@vercel/postgres';
import { drizzle } from 'drizzle-orm/vercel-postgres';
import * as schema from './schema';

// Create Drizzle ORM instance with Vercel Postgres
export const db = drizzle(vercelSql, { schema });
