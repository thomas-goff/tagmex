import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>tagmex</h1>
      <p>A personal budgeting tool that reads bank notification emails.</p>
      <Link href="/privacy">Privacy policy</Link>
    </main>
  );
}
