import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n";
import { SpeedInsights } from "@vercel/speed-insights/next";

const SHORT = "Your group trip, all in one place · 團體旅程，一站掌握";

// Link previews (WhatsApp, iMessage…) use app/opengraph-image.jpg; its address must be absolute.
// Vercel sets VERCEL_PROJECT_PRODUCTION_URL to the production domain (including a custom one).
const site = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "Travel Hub",
  applicationName: "Travel Hub",
  openGraph: { type: "website", siteName: "Travel Hub", title: "Travel Hub", description: SHORT },
  twitter: { card: "summary_large_image", title: "Travel Hub", description: SHORT },
  // Add to Home Screen on iPhone: opens full screen with the site icon and this name.
  appleWebApp: { capable: true, title: "Travel Hub", statusBarStyle: "default" },
  description:
    "Travel Hub — one place for your group trip: the day-by-day itinerary and hotels, a shared cash kitty, split expenses, receipt scanning, budgets, photos and a simple settle-up plan. English & 繁體中文.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f766e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <LanguageProvider>{children}</LanguageProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
