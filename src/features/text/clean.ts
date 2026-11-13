// Text that reaches us from outside (bank emails, a model, a form) and is shown again later, on
// Discord or to a model: control and formatting characters are stripped and the length capped, so
// it can't smuggle instructions, reorder what's displayed or flood a message.
export function cleanText(text: string, limit: number) {
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}
