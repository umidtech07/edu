import type { Metadata } from "next";
import { Patrick_Hand } from "next/font/google";
import "./globals.css";

const patrickHand = Patrick_Hand({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-patrick-hand",
});

export const metadata: Metadata = {
  title: "Classory AI",
  description: "AI-powered lesson slide generator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${patrickHand.variable} antialiased`}
        style={{ fontFamily: "var(--font-patrick-hand), cursive", background: "#f4f6f9" }}
      >
        {children}
      </body>
    </html>
  );
}
