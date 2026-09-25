"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Headphones, Menu, MessageCircle, Plus, RotateCcw, ShieldCheck, X } from "lucide-react";
import { Brand } from "@/components/Brand";

type Section = "assistant" | "history";

export function WorkspaceFrame({ section, children }: { section: Section; children: ReactNode }) {
  const [mobileMenu, setMobileMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const closeMenu = () => {
    setMobileMenu(false);
    requestAnimationFrame(() => menuButton.current?.focus());
  };
  useEffect(() => {
    if (!mobileMenu) return;
    sidebar.current?.querySelector<HTMLButtonElement>(".mobile-close")?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenu(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenu]);
  const nav = [
    { href: "/", label: "语音陪练", icon: Headphones, key: "practice" },
    { href: "/assistant", label: "话术助手", icon: MessageCircle, key: "assistant" },
    { href: "/history", label: "历史记录", icon: RotateCcw, key: "history" },
  ];
  return <div className="app-shell">
    <aside ref={sidebar} id="workspace-navigation" className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`} aria-label="主导航" role={mobileMenu ? "dialog" : undefined} aria-modal={mobileMenu || undefined}>
      <Brand />
      <button className="icon-button mobile-close" aria-label="关闭导航" onClick={closeMenu}><X size={20} /></button>
      <Link className="new-button" href="/"><Plus size={17} />新建陪练</Link>
      <div className="nav-heading">工作区</div>
      {nav.map(({ href, label, icon: Icon, key }) => <Link key={key} className={`nav-item ${section === key ? "nav-active" : ""}`} aria-current={section === key ? "page" : undefined} href={href} onClick={() => setMobileMenu(false)}><Icon size={18} />{label}</Link>)}
      <div className="sidebar-foot"><ShieldCheck size={16} /><span>体验版 · 不保存录音</span></div>
    </aside>
    {mobileMenu && <button className="menu-scrim" aria-label="关闭导航" onClick={closeMenu} />}
    <div className="main-column" inert={mobileMenu}>
      <header className="topbar"><div className="topbar-left"><button ref={menuButton} className="icon-button mobile-menu" aria-label="打开导航" aria-controls="workspace-navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(true)}><Menu size={20} /></button><span className="breadcrumb">工作区 <span>/</span> {section === "assistant" ? "话术助手" : "历史记录"}</span></div><div className="topbar-right"><span className="preview-dot" />销售陪练体验</div></header>
      <main className="main-content">{children}</main>
      <footer className="page-footer"><span>言练 · 销售新人陪练</span><span>练习记录只保存文字，不保存原始录音</span></footer>
    </div>
  </div>;
}
