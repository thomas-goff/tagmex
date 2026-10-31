// A category's emoji, shown beside its name on Discord and the dashboard.

export const DEFAULT_CATEGORY_EMOJI = '🏷️';
export const UNCATEGORISED_EMOJI = '❔';

// Room for flags, skin tones and ZWJ sequences such as 👨‍👩‍👧, but not for text.
const MAX_LENGTH = 16;
const PICTOGRAPH = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Component}|‍|️)+$/u;

// One emoji, trimmed; null when it isn't one.
export function parseEmoji(value: string) {
  const emoji = value.trim();
  return emoji.length > 0 && emoji.length <= MAX_LENGTH && PICTOGRAPH.test(emoji) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(emoji)
    ? emoji
    : null;
}

export function categoryEmoji(emoji: string | null | undefined, categorised = true) {
  if (!categorised) return UNCATEGORISED_EMOJI;
  return emoji || DEFAULT_CATEGORY_EMOJI;
}
