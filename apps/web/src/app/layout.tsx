import type { Metadata, Viewport } from "next";
import { Azeret_Mono, Geist, Geist_Mono, Spectral } from "next/font/google";
import "./globals.css";
// Interface layer over the base rules; must load after globals.css.
import "./interface.css";
import "./atlas.css";

const spectral = Spectral({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["200", "300", "400"],
  style: ["normal", "italic"],
  display: "swap",
});

const azeret = Azeret_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

// One family for title, interface and data
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Reef Atlas",
  description:
    "Step inside a reef's history. Heat stress, fishing activity, lionfish and hurricanes on Florida's Coral Reef, 2016–2024.",
};

export const viewport: Viewport = {
  themeColor: "#010a12",
  colorScheme: "dark",
  // The globe and reef fill the screen edge to edge; .hud and the wordmark
  // stay inside env(safe-area-inset-*).
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${spectral.variable} ${azeret.variable} ${geist.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
