import styles from './dashboard.module.css';

// Every dashboard page is server-rendered per user, so a tab tap costs a round trip. Without a
// loading boundary Next has nothing to show until it lands (the old page just sits there), and
// nothing to prefetch for a dynamic route either. This skeleton is both: instant feedback on tap,
// and the thing <Link> prefetches.
export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Loading">
      <div className={styles.pageHead}>
        <div>
          <div className={styles.skeleton} style={{ width: '58%', height: 30 }} />
          <div className={styles.skeleton} style={{ width: '78%', height: 15, marginTop: 10 }} />
        </div>
        <div className={styles.skeleton} style={{ height: 44 }} />
      </div>
      <div className={styles.skeleton} style={{ height: 66, marginBottom: 22 }} />
      {[0, 1].map((group) => (
        <div key={group}>
          <div className={styles.skeleton} style={{ width: 150, height: 13, margin: '26px 0 10px' }} />
          <div className={styles.rows}>
            {[0, 1, 2].map((row) => (
              <div key={row} className={styles.row}>
                <span className={styles.skeleton} style={{ width: 22, height: 22, borderRadius: '50%' }} />
                <span className={styles.rowMain}>
                  <span className={styles.skeleton} style={{ width: '55%', height: 15 }} />
                  <span className={styles.skeleton} style={{ height: 6 }} />
                </span>
                <span className={styles.skeleton} style={{ width: 76, height: 15 }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </main>
  );
}
