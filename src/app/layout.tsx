import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "MailPulse · Outlook email from Telegram",
  description: "Connect Outlook securely, then read, reply to, and send email from your private Telegram chat.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
