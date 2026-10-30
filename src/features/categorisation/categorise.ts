import { merchantRuleStep, transferStep, userRuleStep } from './steps';
import {
  UNCATEGORISED,
  type CategorisableTransaction,
  type Categorisation,
  type CategorisationContext,
  type CategorisationStep,
} from './types';

// First match wins. New strategies are added here as steps; categorise itself never changes.
export const DEFAULT_STEPS: readonly CategorisationStep[] = [userRuleStep, merchantRuleStep, transferStep];

interface Options {
  steps?: readonly CategorisationStep[];
  // A step that throws is reported here and skipped.
  onError?: (err: unknown) => void;
}

// Never throws: a broken step falls through to the next, and nothing matching means uncategorised.
export function categorise(
  tx: CategorisableTransaction,
  context: CategorisationContext,
  { steps = DEFAULT_STEPS, onError = (err) => console.error('categorise step failed', err) }: Options = {},
): Categorisation {
  for (const step of steps) {
    try {
      const result = step(tx, context);
      if (result) return result;
    } catch (err) {
      onError(err);
    }
  }
  return UNCATEGORISED;
}
