import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy · tagmex",
};

const CONTACT_EMAIL = "thom.goff3@gmail.com";
const LAST_UPDATED = "30 October 2026";

export default function PrivacyPolicy() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px", lineHeight: 1.6 }}>
      <h1>Privacy policy</h1>
      <p>Last updated: {LAST_UPDATED}</p>

      <p>
        tagmex is a personal budgeting tool run by Thomas Goff for personal use. It is not offered
        to the public. This policy explains what it does with data from a connected Google account.
      </p>

      <h2>What we access</h2>
      <p>
        With your permission, tagmex uses the Gmail API with read-only access (
        <code>gmail.readonly</code>). It only reads transaction notification emails sent by your bank
        (currently Absa NotifyMe, <code>notifyme@absa.co.za</code>). Other emails are not opened: tagmex
        reads only their sender address, to skip them. tagmex cannot send, delete, label or change
        any email.
      </p>

      <h2>How we use it</h2>
      <p>From each bank notification, tagmex extracts the transaction details:</p>
      <ul>
        <li>amount, date, merchant or reference, and transaction type</li>
        <li>account type and the last four digits of the account number</li>
        <li>the available balance shown in the email</li>
      </ul>
      <p>
        These details are used only to track spending and are posted to a private Discord channel that
        only the account owner can see. tagmex does not use Gmail data for advertising, does not
        sell it, and does not use it to train AI or machine learning models.
      </p>

      <h2>What we store</h2>
      <p>
        tagmex does not store email bodies. Its database keeps a record of each processed email: the
        Gmail message ID, whether it was a transaction, any parsing error, and timestamps. This stops
        an email from being processed twice. It also stores the Gmail address and a sync position
        (Gmail history ID). The Google access token is held as an encrypted environment variable in
        the hosting provider, not in the database.
      </p>

      <h2>Who processes it</h2>
      <p>tagmex relies on these services to run:</p>
      <ul>
        <li>Google (Gmail API), the source of the emails</li>
        <li>Vercel, which hosts the application</li>
        <li>Supabase, which hosts the database described above</li>
        <li>Discord, which delivers the transaction notifications</li>
      </ul>
      <p>No data is shared with anyone else, except where required by law.</p>

      <h2>Google API Services User Data Policy</h2>
      <p>
        tagmex&apos;s use and transfer to any other app of information received from Google APIs will
        adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Processing records are kept for as long as the account stays connected. You can revoke
        tagmex&apos;s access at any time at{" "}
        <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>. To
        have the stored records deleted, email the address below and they will be removed within 30
        days.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit (HTTPS). The database is not exposed publicly, and access to it
        and to the hosting environment is limited to the operator.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, the date at the top will be updated.</p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </main>
  );
}
