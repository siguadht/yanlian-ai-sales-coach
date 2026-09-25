"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";
import { usePathname } from "next/navigation";
import { authStatus, loginWithCode } from "@/lib/api";
import { AiCustomerAvatar } from "@/components/AiCustomerAvatar";
import { Brand } from "@/components/Brand";

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublicPage = pathname === "/landing";
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isPublicPage) return;
    let live = true;
    authStatus().then((state) => { if (live) setReady(state.authenticated); })
      .catch(() => { if (live) setError("无法连接服务，请刷新页面重试"); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [isPublicPage]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await loginWithCode(code.trim()); setCode(""); setReady(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "体验码验证失败"); }
    finally { setBusy(false); }
  }

  if (isPublicPage || ready) return <>{children}</>;

  if (checking) {
    return <main className="auth-screen auth-checking">
      <div className="auth-checking-orb"><AiCustomerAvatar state="thinking" featured /></div>
      <div role="status">
        <strong>正在准备练习空间</strong>
        <span>马上就好</span>
      </div>
    </main>;
  }

  return <main className="auth-screen">
    <section className="auth-shell">
      <div className="auth-story">
        <div className="auth-story-brand"><Brand /></div>
        <div className="auth-story-copy">
          <span className="auth-kicker"><i />PRIVATE PRACTICE SPACE</span>
          <h1>先练好每句话，<br />再面对真实客户<span>。</span></h1>
          <p>AI 扮演客户，陪你反复演练真实销售场景。开口、复盘、再进步，都在你的独立空间里完成。</p>
        </div>
        <div className="auth-orb-stage" aria-hidden="true">
          <span className="auth-orbit auth-orbit-outer" />
          <span className="auth-orbit auth-orbit-inner" />
          <AiCustomerAvatar state="idle" featured />
          <span className="auth-float-note auth-note-top">随时开练</span>
          <span className="auth-float-note auth-note-bottom">即时复盘</span>
        </div>
        <div className="auth-proof">
          <span><Check size={13} strokeWidth={2.5} />双角色实战</span>
          <span><Check size={13} strokeWidth={2.5} />语音自然对话</span>
          <span><Check size={13} strokeWidth={2.5} />记录独立保存</span>
        </div>
      </div>

      <div className="auth-entry">
        <div className="auth-entry-inner">
          <span className="auth-entry-index">01 / ACCESS</span>
          <div className="auth-lock"><LockKeyhole size={20} strokeWidth={1.7} /></div>
          <h2>进入你的练习室</h2>
          <p>输入邀请人提供的体验码。每位体验者拥有独立记录，互不影响。</p>
          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor="invite-code">体验码</label>
            <div className="auth-input-wrap">
              <input
                id="invite-code"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="请输入体验码"
                aria-describedby={error ? "auth-error" : "auth-code-hint"}
                aria-invalid={Boolean(error)}
                required
                autoFocus
              />
              <span aria-hidden="true">••••</span>
            </div>
            <span id="auth-code-hint" className="auth-hint">体验码仅用于验证身份，不会显示在练习记录中。</span>
            {error && <span id="auth-error" role="alert" className="auth-error">{error}</span>}
            <button type="submit" disabled={busy || !code.trim()}>
              <span>{busy ? "正在验证…" : "开始体验"}</span>
              {!busy && <ArrowRight size={17} strokeWidth={2} />}
              {busy && <i className="auth-spinner" aria-hidden="true" />}
            </button>
          </form>
          <div className="auth-privacy"><LockKeyhole size={12} />你的对话与练习记录仅在当前体验身份下可见</div>
        </div>
      </div>
    </section>
    <footer className="auth-footer"><span>YANLI SALES PRACTICE</span><span>把每句话练成底气</span></footer>
  </main>;
}
