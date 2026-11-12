import type { Metadata } from "next";
import "./globals.css";
// AG Grid Community v32 requires its structural CSS and legacy Quartz theme.
// Keep these imports in order, after Tailwind resets in globals.css.
import "@ag-grid-community/styles/ag-grid.css";
import "@ag-grid-community/styles/ag-theme-quartz.css";
export const metadata: Metadata = { title: "AgentTrust Gateway", description: "Merchant-side identity, consent and spending policy gateway for AI agent commerce." };
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
