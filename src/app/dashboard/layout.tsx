import { UserButton } from '@clerk/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/features/auth/session';
import styles from './dashboard.module.css';
import { TabBar, WideNav } from './nav';

export const metadata: Metadata = {
  title: 'Dashboard · Tagmex',
};

export default async function DashboardLayout({ children }: LayoutProps<'/dashboard'>) {
  await requireUser();
  return (
    <div className={styles.shell}>
      {/* Opaque, full width and stuck to the top edge on purpose: that's what iOS 26 samples for
          the status bar colour, and what stops iOS 27 drawing its blur band over the content. */}
      <header className={styles.appbar}>
        <div className={styles.appbarInner}>
          <Link href="/dashboard" className={styles.brand}>
            Tagmex
          </Link>
          <WideNav />
          <UserButton />
        </div>
      </header>
      <div className={styles.content}>{children}</div>
      <TabBar />
    </div>
  );
}
