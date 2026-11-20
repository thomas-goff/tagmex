import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tagmex",
  applicationName: "Tagmex",
  // Bank descriptions are full of digits; without this iOS turns them into phone links.
  formatDetection: { telephone: false, address: false, date: false, email: false },
  appleWebApp: {
    capable: true,
    title: "Tagmex",
    // The status bar text follows the system appearance; the sticky app bar paints the area
    // behind it (see .appbar in dashboard.module.css).
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout reach into the notch and home-indicator areas; without it every
  // env(safe-area-inset-*) reads 0 in an installed iOS web app.
  viewportFit: "cover",
  // Ignored by Safari 26+ (which samples the top edge element instead) but still used by
  // Android and older Safari. Keep in step with the .appbar background.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1d23" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider signInUrl="/sign-in" signInFallbackRedirectUrl="/dashboard">
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
