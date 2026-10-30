// Lets an email sign in to the MCP server as an app user. The first time that person connects
// Claude (signing in with Clerk), their Clerk account is linked to this row by verified email.
// Usage: npm run users:allow -- --email you@example.com                 as the phase 1-2 owner
//        npm run users:allow -- --email kelly@example.com --id kelly
//        npm run users:allow -- --email you@example.com --unlink        after moving Clerk instance
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createAppUserRepo } from '@/features/users/app-users';
import { OWNER_USER_ID } from '@/features/users/owner';
import { openDatabase, runScript } from './_db';

const { values: args } = parseArgs({
  options: {
    email: { type: 'string' },
    id: { type: 'string', default: OWNER_USER_ID },
    name: { type: 'string' },
    unlink: { type: 'boolean', default: false },
  },
});

runScript(async () => {
  const email = z.email().parse(args.email, { error: () => 'pass --email you@example.com' });
  const { db, close } = openDatabase();
  try {
    const user = await createAppUserRepo(db).upsert({ id: args.id!, email, displayName: args.name, unlink: args.unlink });
    console.log(`Allowed ${user.email} as user "${user.id}".`);
    console.log(user.clerkUserId ? `Linked to Clerk user ${user.clerkUserId}.` : 'Not linked yet: links on first MCP sign-in.');
  } finally {
    await close();
  }
});
