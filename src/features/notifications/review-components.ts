import { categoryEmoji } from '@/features/categorisation/emoji';
import { clip, type DiscordActionRow, type DiscordButton } from './embeds';

// The controls under a #needs-review message: a dropdown of categories, Accept when there's a
// suggestion, and Exclude. Each control's custom_id names what it does to which transaction; the
// interactions endpoint (./review-interactions) acts on it.

export interface ReviewCategory {
  id: string;
  name: string;
  emoji: string | null;
}

export type ReviewAction =
  // A category picked from the dropdown, or a suggestion accepted.
  | { kind: 'categorise'; transactionId: string; categoryId: string }
  // The same, after a preview said the learned rule would change many transactions.
  | { kind: 'confirm'; transactionId: string; categoryId: string }
  | { kind: 'exclude'; transactionId: string };

// Discord's limits.
const MAX_OPTIONS = 25;
const MAX_OPTION_LABEL = 100;
const MAX_BUTTON_LABEL = 80;

const PREFIX = 'review';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const label = (c: ReviewCategory) => `${categoryEmoji(c.emoji)} ${c.name}`;

export function reviewComponents(transactionId: string, categories: readonly ReviewCategory[], suggestedId: string | null = null): DiscordActionRow[] {
  const suggested = categories.find((c) => c.id === suggestedId) ?? null;
  // The suggestion always makes the cut when there are more categories than Discord allows.
  const listed = suggested ? [suggested, ...categories.filter((c) => c !== suggested)].slice(0, MAX_OPTIONS) : categories.slice(0, MAX_OPTIONS);
  const options = [...listed]
    .sort((a, b) => categories.indexOf(a) - categories.indexOf(b))
    .map((c) => ({ label: clip(label(c), MAX_OPTION_LABEL), value: c.id, ...(c === suggested ? { default: true } : {}) }));

  const buttons: DiscordButton[] = [];
  if (suggested) {
    buttons.push({ type: 2, style: 3, label: clip(`Accept ${label(suggested)}`, MAX_BUTTON_LABEL), custom_id: `${PREFIX}:accept:${transactionId}:${suggested.id}` });
  }
  buttons.push({ type: 2, style: 2, label: '🗑️ Exclude', custom_id: `${PREFIX}:exclude:${transactionId}` });

  return [
    // A dropdown needs at least one option.
    ...(options.length > 0
      ? [{ type: 1 as const, components: [{ type: 3 as const, custom_id: `${PREFIX}:pick:${transactionId}`, placeholder: 'File it under…', options }] }]
      : []),
    { type: 1, components: buttons },
  ];
}

// The button on the "this would change N transactions" reply.
export function confirmComponents(transactionId: string, category: ReviewCategory, count: number): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: clip(`Yes, file all ${count} as ${label(category)}`, MAX_BUTTON_LABEL), custom_id: `${PREFIX}:confirm:${transactionId}:${category.id}` },
      ],
    },
  ];
}

// What a clicked control asks for, or null for anything that isn't one of ours. `values` is the
// dropdown's selection.
export function parseReviewAction(customId: string, values: readonly string[] = []): ReviewAction | null {
  const [prefix, verb, transactionId, categoryId] = customId.split(':');
  if (prefix !== PREFIX || !transactionId || !UUID.test(transactionId)) return null;
  switch (verb) {
    case 'pick':
      return values[0] && UUID.test(values[0]) ? { kind: 'categorise', transactionId, categoryId: values[0] } : null;
    case 'accept':
    case 'confirm':
      return categoryId && UUID.test(categoryId) ? { kind: verb === 'accept' ? 'categorise' : 'confirm', transactionId, categoryId } : null;
    case 'exclude':
      return { kind: 'exclude', transactionId };
    default:
      return null;
  }
}
