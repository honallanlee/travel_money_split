import type { MetadataRoute } from "next";

/** Lets people add Travel Hub to their phone's home screen with the traveller icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Travel Hub",
    short_name: "Travel Hub",
    description: "Your group trip, all in one place",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f5f2",
    theme_color: "#0f766e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
