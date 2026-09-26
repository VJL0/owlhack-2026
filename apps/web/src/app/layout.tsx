import type { Metadata, Viewport } from "next";
import { Azeret_Mono, Spectral } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Reef Sentinel",
  description:
    "Step inside a reef's history. Heat stress, fishing activity, lionfish and hurricanes on Florida's Coral Reef, 2016–2024.",
};

export const viewport: Viewport = {
  themeColor: "#010a12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${spectral.variable} ${azeret.variable}`}>
      <body>{children}</body>
    </html>
  );
}
