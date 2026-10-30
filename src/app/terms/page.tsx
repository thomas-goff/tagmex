import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of service · tagmex",
};

const CONTACT_EMAIL = "thom.goff3@gmail.com";
const LAST_UPDATED = "30 October 2026";

export default function TermsOfService() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px", lineHeight: 1.6 }}>
      <h1>Terms of service</h1>
      <p>Last updated: {LAST_UPDATED}</p>

      <p>
        tagmex is a personal budgeting tool run by Thomas Goff for personal use. By connecting a
        Google account to tagmex you agree to these terms.
      </p>

      <h2>The service</h2>
      <p>
        tagmex reads bank transaction notification emails from a connected Gmail account with read-only
        access, extracts the transaction details and sends them to a private Discord channel. It is
        not offered to the public. Access is limited to people the operator has invited.
      </p>

      <h2>Your account</h2>
      <p>
        Connect only a Google account that you own or are authorised to use. You can disconnect at any
        time by revoking access at{" "}
        <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
      </p>

      <h2>Not financial advice</h2>
      <p>
        tagmex is an informational tool. It is not a bank, does not move money, and does not provide
        financial, tax or investment advice. Your bank&apos;s own records and statements are the
        authoritative source for your balances and transactions.
      </p>

      <h2>No warranty</h2>
      <p>
        tagmex is provided &quot;as is&quot;, without warranties of any kind. Notifications can be
        delayed, missed or parsed incorrectly, for example if a bank changes its email format. Do not
        rely on tagmex as your only record of your finances.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent permitted by law, the operator is not liable for any loss or damage arising from
        the use of, or inability to use, tagmex, including decisions made based on its output.
      </p>

      <h2>Your data</h2>
      <p>
        How tagmex handles data from your Google account is described in the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>Changes and termination</h2>
      <p>
        These terms may be updated, in which case the date at the top will change. The operator may
        suspend or stop the service at any time. Continuing to use tagmex after a change means you
        accept the updated terms.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of the Republic of South Africa.</p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </main>
  );
}
