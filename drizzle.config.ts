import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd()); // drizzle-kit doesn't read .env.local on its own

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['public'],
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL! },
  verbose: true,
});
