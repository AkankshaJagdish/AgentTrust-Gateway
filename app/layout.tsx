import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "AgentTrust Gateway", description: "Merchant-side identity, consent and spending policy gateway for AI agent commerce." };
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
