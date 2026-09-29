import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "relaxAI Generative UI — reference app",
  description:
    "A Next.js App Router application demonstrating schema-enforced, streaming generative UI on Civo relaxAI.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
