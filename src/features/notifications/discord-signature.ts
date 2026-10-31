// Discord signs every request to the interactions endpoint with the application's Ed25519 key:
// X-Signature-Ed25519 over X-Signature-Timestamp + the raw body. Anything that fails gets a 401,
// which Discord also checks for when the endpoint URL is saved.

const HEX = /^(?:[0-9a-f]{2})+$/i;

export async function verifyDiscordSignature(publicKeyHex: string, signatureHex: string, timestamp: string, body: string) {
  if (!HEX.test(publicKeyHex) || !HEX.test(signatureHex) || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey('raw', Buffer.from(publicKeyHex, 'hex'), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, Buffer.from(signatureHex, 'hex'), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}
