import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';

// The first page anyone sees. The policy links stay public: the OAuth consent screen links to them.
export default function SignInPage() {
  return (
    <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '48px 16px' }}>
      <SignIn fallbackRedirectUrl="/dashboard" />
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        <Link href="/privacy">Privacy policy</Link> · <Link href="/terms">Terms of service</Link>
      </p>
    </main>
  );
}
