import type { Metadata } from "next";
import { SessionProvider } from "@/lib/session";
import { NavShell } from "@/components/NavShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blanify Admin",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <NavShell>{children}</NavShell>
        </SessionProvider>
      </body>
    </html>
  );
}
