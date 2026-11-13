// Proof that a bank email really came from the bank, not just that its From header says so.
//
// Gmail checks every message on arrival and prepends an Authentication-Results header naming itself
// (mx.google.com). Only that topmost header is trusted: the sender can put any Authentication-Results
// headers they like further down. DMARC pass with header.from=<bank's domain> means the From domain
// was proven by an aligned SPF or DKIM signature, so a forged "notifyme@absa.co.za" fails here even
// if it reaches the inbox.

const AUTHSERV_ID = 'mx.google.com';

// The address in a From header: "Absa <notifyme@absa.co.za>" or a bare "notifyme@absa.co.za".
// Null for anything else, including headers with more than one address.
export function fromAddress(from: string) {
  const header = from.trim();
  const angled = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(header);
  const address = angled ? angled[1]! : header;
  if (!/^[^\s@<>,]+@[^\s@<>,]+$/.test(address)) return null;
  if (angled && (header.slice(0, angled.index).match(/@/g)?.length ?? 0) > 0) return null; // "a@x.com <b@y.com>"
  return address.toLowerCase();
}

// Null when the email's topmost Authentication-Results (Gmail's own) shows a DMARC pass for the
// domain of `sender`; otherwise why it doesn't.
export function senderAuthFailure(authenticationResults: string, sender: string): string | null {
  const domain = sender.trim().toLowerCase().split('@')[1];
  if (!domain) return `"${sender}" is not an email address`;
  const results = authenticationResults.trim().toLowerCase();
  if (!results) return 'no Authentication-Results header from Gmail';
  const authserv = results.split(';', 1)[0]!.trim();
  if (authserv !== AUTHSERV_ID) return `topmost Authentication-Results is from "${authserv}", not ${AUTHSERV_ID}`;
  const dmarc = results
    .split(';')
    .map((r) => r.trim())
    .find((r) => r.startsWith('dmarc='));
  if (!dmarc) return 'Gmail recorded no DMARC result';
  if (!dmarc.startsWith('dmarc=pass')) return `DMARC ${dmarc.split(/\s/, 1)[0]!.slice('dmarc='.length)}`;
  const from = /header\.from=([^\s;]+)/.exec(dmarc)?.[1];
  if (from !== domain) return `DMARC passed for "${from ?? 'unknown'}", not ${domain}`;
  return null;
}
