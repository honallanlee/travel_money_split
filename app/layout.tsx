import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Travel Hub",
  applicationName: "Travel Hub",
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
      </body>
    </html>
  );
}
