import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tradewise — autonomous on-chain agent",
  description:
    "Reliable Uniswap swap concierge. Pay per quote in USDC. ENS: tradewise.agentlab.eth",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
