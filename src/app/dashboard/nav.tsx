'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './dashboard.module.css';

// The four places there are. On a phone they're a bottom tab bar, within thumb reach and above
// the home indicator; from 768px up they're links in the app bar instead.
export const TABS = [
  { href: '/dashboard', label: 'Overview', icon: 'overview' },
  { href: '/dashboard/transactions', label: 'Transactions', icon: 'transactions' },
  { href: '/dashboard/budget', label: 'Budget', icon: 'budget' },
  { href: '/dashboard/savings', label: 'Savings', icon: 'savings' },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
] as const;

type IconName = (typeof TABS)[number]['icon'];

function Icon({ name }: { name: IconName }) {
  // 24px line icons, drawn on a 24 grid so they sit on the same optical weight as iOS tab icons.
  const paths: Record<IconName, React.ReactNode> = {
    overview: (
      <>
        <path d="M3 20h18" />
        <path d="M6 20v-7" />
        <path d="M12 20V5" />
        <path d="M18 20v-10" />
      </>
    ),
    transactions: (
      <>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h10" />
      </>
    ),
    budget: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    savings: (
      <>
        <path d="M3.5 10.5h17v7a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
        <path d="M3.5 10.5 12 5l8.5 5.5" />
        <circle cx="12" cy="14.5" r="2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10L5.6 18.4" />
      </>
    ),
  };
  return (
    <svg className={styles.tabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name]}
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  return href === '/dashboard' ? pathname === href : pathname.startsWith(href);
}

// Inside the Link, so useLinkStatus can report that this tab's navigation is in flight.
function TabBody({ icon, label }: { icon: IconName; label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className={styles.tabBody} data-pending={pending}>
      <Icon name={icon} />
      <span>{label}</span>
    </span>
  );
}

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className={styles.tabbar} aria-label="Sections">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={styles.tab} data-active={active} aria-current={active ? 'page' : undefined}>
            <TabBody icon={tab.icon} label={tab.label} />
          </Link>
        );
      })}
    </nav>
  );
}

// The same four links in the app bar, for screens with room for them.
export function WideNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.wideNav} aria-label="Sections">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link key={tab.href} href={tab.href} data-active={active} aria-current={active ? 'page' : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
