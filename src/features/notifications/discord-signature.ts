// Discord signs every request to the interactions endpoint with the application's Ed25519 key:
// X-Signature-Ed25519 over X-Signature-Timestamp + the raw body. Anything that fails gets a 401,
// which Discord also checks for when the endpoint URL is saved.

const HEX = /^(?:[0-9a-f]{2})+$/i;

// A signed request older (or further in the future) than this is refused, so a captured click
// can't be replayed later. Discord delivers within seconds.
export const MAX_SKEW_SECONDS = 5 * 60;

export async function verifyDiscordSignature(publicKeyHex: string, signatureHex: string, timestamp: string, body: string, now = Date.now()) {
  if (!HEX.test(publicKeyHex) || !HEX.test(signatureHex) || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  try {
    const key = await crypto.subtle.importKey('raw', Buffer.from(publicKeyHex, 'hex'), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, Buffer.from(signatureHex, 'hex'), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}
