import { UserButton } from '@clerk/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/features/auth/session';
import styles from './dashboard.module.css';

export const metadata: Metadata = {
  title: 'Dashboard · tagmex',
};

export default async function DashboardLayout({ children }: LayoutProps<'/dashboard'>) {
  await requireUser();
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.brand}>
          tagmex
        </Link>
        <nav className={styles.nav}>
          <Link href="/dashboard">Overview</Link>
          <Link href="/dashboard/transactions">Transactions</Link>
          <Link href="/dashboard/budget">Budget</Link>
          <Link href="/dashboard/settings">Settings</Link>
        </nav>
        <UserButton />
      </header>
      {children}
    </div>
  );
}
