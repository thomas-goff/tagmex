import { SignOutButton } from '@clerk/nextjs';

// Signed in with Clerk, but no verified email on the app's allowlist (npm run users:allow).
export default function NotAllowed() {
  return (
    <main style={{ maxWidth: 520, margin: '0 auto', padding: '64px 16px', lineHeight: 1.6 }}>
      <h1>Not on the list</h1>
      <p>
        This account is signed in, but none of its verified email addresses is allowed into tagmex. It&apos;s a personal tool; if
        it&apos;s yours, add the email with <code>npm run users:allow</code> and sign in again.
      </p>
      <SignOutButton redirectUrl="/">
        <button style={{ font: 'inherit', padding: '8px 14px', cursor: 'pointer' }}>Sign out</button>
      </SignOutButton>
    </main>
  );
}
