import type { Metadata } from "next";
import { AuthTopRight } from "@/components/auth/AuthTopRight";
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
      <body>
        <AuthTopRight />
        {children}
      </body>
    </html>
  );
}
