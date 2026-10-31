import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Clerk session handling for the dashboard. Signed-out visits to /dashboard go to sign-in here;
// requireUser() (src/features/auth/session.ts) checks again on the server for every page and action.
// API routes and OAuth discovery are left alone: /api/mcp takes Clerk OAuth bearer tokens itself,
// the cron routes take CRON_SECRET, and /.well-known must stay public.
const isDashboard = createRouteMatcher(['/dashboard(.*)']);

export default clerkMiddleware(
  async (auth, request) => {
    if (isDashboard(request)) await auth.protect();
  },
  { signInUrl: '/sign-in' },
);

export const config = {
  matcher: [
    // Pages, not API routes, OAuth discovery, Next internals or static files.
    '/((?!api/|\\.well-known/|_next/|favicon\\.ico$|.*\\.(?:css|js|map|png|jpg|jpeg|gif|svg|ico|webp|woff2?|txt)$).*)',
  ],
};
