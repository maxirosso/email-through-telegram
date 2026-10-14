import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "MailPulse", description: "Private email operations through Telegram" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
