// Shared setup for local scripts: loads .env.local and opens the database in DATABASE_URL.
import { loadEnvConfig } from '@next/env';
import { createDb } from '@/db/client';

export function openDatabase() {
  loadEnvConfig(process.cwd());
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL in .env.local');
  // The host only, never credentials: enough to notice the script is pointed at the wrong project.
  console.log(`Database: ${new URL(url).host}\n`);
  return createDb(url);
}

// tsx runs scripts as CJS, so no top-level await: run main and exit non-zero on failure.
export function runScript(main: () => Promise<void>) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
