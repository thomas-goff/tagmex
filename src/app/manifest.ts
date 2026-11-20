import type { MetadataRoute } from "next";

// The installed app. iOS reads start_url and display from here; the home-screen icon comes from
// src/app/apple-icon.png. theme_color can't vary by colour scheme, so it matches the light app
// bar; Safari 26+ ignores it anyway and takes the bar colour from the page's top edge element.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Tagmex",
    short_name: "Tagmex",
    description: "Your budget, from your bank's emails.",
    start_url: "/dashboard",
    scope: "/",
    icons: [
      { src: "/web-app-manifest-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/web-app-manifest-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/maskable-icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    theme_color: "#ffffff",
    background_color: "#f6f7f9",
    display: "standalone",
  };
}
