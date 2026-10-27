import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AgentSpend — spending limits for AI agents",
    template: "%s · AgentSpend",
  },
  description:
    "A per-user NEAR vault that lets AI agents pay merchants only inside a deterministic, on-chain spending policy.",
  applicationName: "AgentSpend",
};

export const viewport: Viewport = {
  themeColor: "#f4f1e8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink antialiased">{children}</body>
    </html>
  );
}
