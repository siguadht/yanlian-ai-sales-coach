import type { Metadata } from "next";
import "./globals.css";
import { AuthGate } from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "销售新人陪练",
  description: "双角色实时语音销售陪练",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}
