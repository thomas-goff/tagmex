import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// No landing page: signed in goes to the dashboard, signed out to sign-in.
export default async function Home() {
  redirect((await auth()).userId ? "/dashboard" : "/sign-in");
}
