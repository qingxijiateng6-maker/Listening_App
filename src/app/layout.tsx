import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Listening App",
  description: "C1/C2 listening practice app scaffold",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
