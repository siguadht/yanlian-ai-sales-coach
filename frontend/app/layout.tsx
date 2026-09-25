import type { Metadata } from "next";
import "./globals.css";
import { AuthGate } from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "言练｜AI 销售新人陪练",
  description: "双角色 AI 销售陪练：练习真实异议、连续语音对话与训练复盘。",
  icons: { icon: `${process.env.NEXT_PUBLIC_SITE_MODE === "landing" ? "/yanlian-ai-sales-coach" : ""}/icon.svg` },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}
