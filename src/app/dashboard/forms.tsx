'use client';

import { useActionState, useState } from 'react';
import type { ExpenseType } from '@/features/categorisation/types';
import {
  categoriseAction,
  createCategoryAction,
  saveBudgetItemAction,
  saveNotificationsAction,
  saveSalaryAction,
  setExcludedAction,
  type ActionState,
} from './actions';
import styles from './dashboard.module.css';
import { cx } from './ui';

export interface CategoryOption {
  id: string;
  name: string;
  emoji: string;
}

function Feedback({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <span role="status" className={cx(styles.subtle, !state.ok && styles.late)}>
      {state.ok ? `✓ ${state.message}` : state.message}
    </span>
  );
}

// Pick a category for a transaction. Learns a rule for its description; when that would also change
// many similar transactions, asks first.
export function CategoriseForm({ transactionId, categories, currentId }: { transactionId: string; categories: CategoryOption[]; currentId: string | null }) {
  const [state, action, pending] = useActionState(categoriseAction, null);
  const [choice, setChoice] = useState(currentId ?? '');
  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="transactionId" value={transactionId} />
      <select name="categoryId" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Category">
        <option value="" disabled>
          Choose…
        </option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.emoji} {c.name}
          </option>
        ))}
      </select>
      {state?.confirm ? (
        <button className={cx(styles.button, styles.primary, styles.small)} name="confirm" value="1" disabled={pending}>
          Yes, all {state.confirm.wouldAlsoChange + 1}
        </button>
      ) : (
        <button className={cx(styles.button, styles.small)} disabled={pending || !choice || choice === currentId}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      )}
      <Feedback state={state} />
    </form>
  );
}

export function ExcludeButton({ transactionId, excluded }: { transactionId: string; excluded: boolean }) {
  const [state, action, pending] = useActionState(setExcludedAction, null);
  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="transactionId" value={transactionId} />
      <input type="hidden" name="excluded" value={excluded ? '0' : '1'} />
      <button className={cx(styles.button, styles.small)} disabled={pending} title={excluded ? 'Count it in totals again' : 'Leave it out of every total'}>
        {excluded ? 'Restore' : 'Exclude'}
      </button>
      {state && !state.ok && <Feedback state={state} />}
    </form>
  );
}

export interface BudgetRowValues {
  categoryId: string;
  name: string;
  emoji: string;
  allocated: string;
  expenseType: ExpenseType;
  expectedDay: number | null;
  isActive: boolean;
}

export function BudgetRowForm({ row }: { row: BudgetRowValues }) {
  const [state, action, pending] = useActionState(saveBudgetItemAction, null);
  const [type, setType] = useState(row.expenseType);
  return (
    <form action={action} className={styles.budgetRow}>
      <input type="hidden" name="categoryId" value={row.categoryId} />
      <input name="emoji" defaultValue={row.emoji} aria-label={`${row.name} emoji`} maxLength={16} />
      <span className={styles.cardName} title={row.name}>
        {row.name}
      </span>
      <input name="allocated" defaultValue={row.allocated} inputMode="decimal" aria-label={`${row.name} budget per cycle`} />
      <select name="expenseType" value={type} onChange={(e) => setType(e.target.value as ExpenseType)} aria-label={`${row.name} type`}>
        <option value="dynamic">Dynamic</option>
        <option value="static">Static</option>
        <option value="irregular">Irregular</option>
      </select>
      <input
        name="expectedDay"
        defaultValue={row.expectedDay ?? ''}
        inputMode="numeric"
        placeholder={type === 'static' ? 'Day' : '—'}
        disabled={type !== 'static'}
        aria-label={`${row.name} debit order day`}
      />
      <label className={cx(styles.field, styles.check)}>
        <input type="checkbox" name="active" defaultChecked={row.isActive} /> Active
      </label>
      <span className={styles.inlineForm}>
        <button className={cx(styles.button, styles.small)} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <Feedback state={state} />
      </span>
    </form>
  );
}

export function NewCategoryForm() {
  const [state, action, pending] = useActionState(createCategoryAction, null);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  return (
    <form action={action}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          Name
          <input name="name" required maxLength={40} />
        </label>
        <label className={styles.field}>
          Emoji
          <input name="emoji" placeholder="🏷️" maxLength={16} />
        </label>
        <label className={styles.field}>
          Kind
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as 'expense' | 'income')}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label className={styles.field}>
          Type
          <select name="expenseType" defaultValue="dynamic" disabled={kind === 'income'}>
            <option value="dynamic">Dynamic</option>
            <option value="static">Static</option>
            <option value="irregular">Irregular</option>
          </select>
        </label>
        <label className={styles.field}>
          Budget per cycle
          <input name="allocated" inputMode="decimal" placeholder="0.00" disabled={kind === 'income'} />
        </label>
      </div>
      {kind === 'income' && <input type="hidden" name="expenseType" value="dynamic" />}
      <div className={styles.formActions}>
        <button className={cx(styles.button, styles.primary)} disabled={pending}>
          {pending ? 'Adding…' : 'Add category'}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function SalaryForm({ salaryDay, expectedSalary, tolerancePct }: { salaryDay: number; expectedSalary: string; tolerancePct: number }) {
  const [state, action, pending] = useActionState(saveSalaryAction, null);
  return (
    <form action={action}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          Salary day (31 = month end)
          <input name="salaryDay" type="number" min={1} max={31} defaultValue={salaryDay} required />
        </label>
        <label className={styles.field}>
          Expected amount (empty = any)
          <input name="expectedSalary" inputMode="decimal" defaultValue={expectedSalary} />
        </label>
        <label className={styles.field}>
          Tolerance %
          <input name="tolerancePct" type="number" min={0} max={100} defaultValue={tolerancePct} required />
        </label>
      </div>
      <div className={styles.formActions}>
        <button className={cx(styles.button, styles.primary)} disabled={pending}>
          {pending ? 'Saving…' : 'Save salary'}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function NotificationsForm({ digestEnabled, digestHour, alertsEnabled }: { digestEnabled: boolean; digestHour: number; alertsEnabled: boolean }) {
  const [state, action, pending] = useActionState(saveNotificationsAction, null);
  return (
    <form action={action}>
      <div className={styles.formGrid}>
        <label className={cx(styles.field, styles.check)}>
          <input type="checkbox" name="digestEnabled" defaultChecked={digestEnabled} /> Daily digest
        </label>
        <label className={styles.field}>
          Digest from (hour, SA time)
          <input name="digestHour" type="number" min={0} max={23} defaultValue={digestHour} required />
        </label>
        <label className={cx(styles.field, styles.check)}>
          <input type="checkbox" name="alertsEnabled" defaultChecked={alertsEnabled} /> Budget alerts
        </label>
      </div>
      <div className={styles.formActions}>
        <button className={cx(styles.button, styles.primary)} disabled={pending}>
          {pending ? 'Saving…' : 'Save notifications'}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
