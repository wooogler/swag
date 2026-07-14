import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Use standard PostgreSQL connection for self-hosted deployment
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';

// Only throw error at runtime, not during build
// During build, Next.js analyzes routes but doesn't actually connect to DB
if (!connectionString && typeof window === 'undefined') {
  // We're in Node.js (server-side)
  // Only warn during build, error will occur when actually trying to query
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
    throw new Error('POSTGRES_URL or DATABASE_URL environment variable is required');
  }
}

const client = postgres(connectionString || 'postgresql://dummy@localhost/dummy', {
  // Lazy connection: only connect when actually querying
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
  // Silence PostgreSQL NOTICE logs (e.g. "already exists, skipping" from our
  // idempotent CREATE/ALTER ... IF (NOT) EXISTS DDL). These are informational,
  // not errors; postgres-js prints them to the console by default.
  onnotice: () => {},
});

// Create Drizzle ORM instance with postgres-js
export const db = drizzle(client, { schema });
