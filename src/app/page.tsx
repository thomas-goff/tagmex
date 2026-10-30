import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>tagmex</h1>
      <p>A personal budgeting tool that reads bank notification emails.</p>
      <p>
        <Link href="/privacy">Privacy policy</Link> · <Link href="/terms">Terms of service</Link>
      </p>
    </main>
  );
}
