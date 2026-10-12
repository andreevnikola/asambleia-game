import type { Metadata, Viewport } from "next";
import { Fira_Sans_Extra_Condensed, Onest } from "next/font/google";
import { APP_TITLE } from "@/lib/copy";
import "./globals.css";

const display = Fira_Sans_Extra_Condensed({
  subsets: ["cyrillic", "latin"],
  weight: ["700", "800"],
  style: ["normal", "italic"],
  variable: "--f-display",
  display: "swap",
});

const body = Onest({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--f-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_TITLE,
  description: "Платформа за играта на Дистриктната Интеракт Асамблея.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#006BB7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
