"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ArrowRight, AudioLines, ChevronDown, ChevronLeft, Headphones, Keyboard, Menu, MessageCircle, Mic, PenTool, PhoneCall, Plus, RotateCcw, Send, ShieldCheck, Sparkles, Volume2, X } from "lucide-react";
import { Brand } from "@/components/Brand";
import { AiCustomerAvatar } from "@/components/AiCustomerAvatar";
import { createSession, endSession, getSession, sendText, synthesizeSpeech } from "@/lib/api";
import { playWavBase64 } from "@/lib/audio";
import { useLiveCall } from "@/hooks/use-live-call";
import type { BusinessRole, CustomerType, DecorationScene, Difficulty, Evaluation, Industry, Message, PlayerRole, Session } from "@/lib/types";
import LandingPage from "./landing/page";

const industries: Industry[] = ["装修", "教育课程", "保险"];
const customerTypes: CustomerType[] = ["爱砍价型", "挑剔型", "冷漠型"];
const difficulties: Difficulty[] = ["温和", "难缠"];
type PracticeMode = "choose" | "voice" | "text";
type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };
const asError = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试";
const localMessage = (role: BusinessRole, content: string): Message => ({ id: `local-${crypto.randomUUID()}`, role, content, created_at: new Date().toISOString() });
const formatCallDuration = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const callText = {
  idle: ["准备就绪", "点开始连续通话后，无需按住按钮即可说话"],
  connecting: ["正在连接", "正在申请麦克风并连接语音服务"],
  listening: ["正在听您说话", "说完停顿约 1 秒，AI 会自动回应"],
  thinking: ["AI 正在思考", "已经收到您的话，正在组织回应"],
  speaking: ["AI 正在说话", "播报结束后会自动继续收听"],
  disconnected: ["连接已断开", "已保存的对话还在，可以重新连接"],
};

function ProductHome() {
  const [role, setRole] = useState<PlayerRole>("sales");
  const [industry, setIndustry] = useState<Industry>("装修");
  const [scene, setScene] = useState<DecorationScene | null>(null);
  const [customerType, setCustomerType] = useState<CustomerType>("挑剔型");
  const [difficulty, setDifficulty] = useState<Difficulty>("温和");
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [audioNotice, setAudioNotice] = useState("");
  const [openingBusy, setOpeningBusy] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("choose");
  const [voiceTranscriptOpen, setVoiceTranscriptOpen] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const openingPlayed = useRef(false);
  const openingAbort = useRef<AbortController | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const startView = useRef<HTMLElement>(null);

  const onFinal = useCallback((text: string) => setMessages((prev) => [...prev, localMessage(role, text)]), [role]);
  const onReply = useCallback((replyRole: BusinessRole, text: string) => setMessages((prev) => [...prev, localMessage(replyRole, text)]), []);
  const live = useLiveCall({ onFinal, onReply });
  const inCall = ["connecting", "listening", "thinking", "speaking"].includes(live.status);
  const active = session?.status === "in_progress";

  useEffect(() => {
    if (!inCall) return;
    const startedAt = Date.now();
    const interval = window.setInterval(() => setCallSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [inCall]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("session");
    if (!id) { Promise.resolve().then(() => setLoading(false)); return; }
    getSession(id).then((detail) => {
      setSession(detail.session);
      setRole(detail.session.player_role);
      setIndustry(detail.session.industry);
      setScene(detail.session.scene);
      setCustomerType(detail.session.customer_type);
      setDifficulty(detail.session.difficulty);
      setMessages(detail.messages);
      setEvaluation(detail.evaluation);
      if (detail.session.status !== "in_progress") setPracticeMode("text");
    }).catch((cause) => setError(`无法恢复会话：${asError(cause)}`)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length]);
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

  const refresh = async (id: string) => {
    const detail = await getSession(id);
    setSession(detail.session);
    setMessages(detail.messages);
    setEvaluation(detail.evaluation);
  };
  const playOpening = (text: string) => {
    openingAbort.current?.abort();
    const controller = new AbortController();
    openingAbort.current = controller;
    const task = (async () => {
      setOpeningBusy(true);
      setAudioNotice("");
      try { await playWavBase64(await synthesizeSpeech(text), controller.signal); }
      catch (cause) {
        if (!controller.signal.aborted) setAudioNotice(`开场语音未播放：${asError(cause)}。您仍可阅读文字并继续陪练。`);
      } finally {
        if (openingAbort.current === controller) { openingAbort.current = null; setOpeningBusy(false); }
      }
    })();
    return task;
  };
  const begin = async () => {
    if (submitting.current || (industry === "装修" && !scene)) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const result = await createSession({ industry, scene: industry === "装修" ? scene : null, customer_type: customerType, difficulty, player_role: role });
      setSession(result.session);
      setMessages(result.opening ? [localMessage("customer", result.opening)] : []);
      setEvaluation(null);
      setPracticeMode("choose");
      setVoiceTranscriptOpen(false);
      openingPlayed.current = false;
      window.history.replaceState(null, "", `/?session=${encodeURIComponent(result.session.id)}`);
    } catch (cause) { setError(asError(cause)); }
    finally { submitting.current = false; setBusy(false); }
  };
  const send = async () => {
    const content = draft.trim();
    if (!session || !content || busy || inCall || submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setDraft("");
    setMessages((prev) => [...prev, localMessage(role, content)]);
    let reply = "";
    try {
      await sendText(session.id, content, {
        onChunk: (text) => {
          reply += text;
          setMessages((prev) => {
            const last = prev.at(-1);
            if (last?.id === "streaming") return [...prev.slice(0, -1), { ...last, content: reply }];
            return [...prev, { ...localMessage(role === "sales" ? "customer" : "sales", reply), id: "streaming" }];
          });
        },
        onDone: (text) => { reply = text || reply; },
      });
      await refresh(session.id);
    } catch (cause) { setError(asError(cause)); await refresh(session.id).catch(() => {}); }
    finally { submitting.current = false; setBusy(false); }
  };
  const finish = async () => {
    if (!session || busy || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      openingAbort.current?.abort();
      if (inCall) await live.stop();
      setEvaluation(await endSession(session.id));
      setPracticeMode("text");
      await refresh(session.id);
    } catch (cause) { setError(asError(cause)); }
    finally { submitting.current = false; setBusy(false); }
  };
  const newPractice = async () => {
    if (active && !window.confirm("离开当前陪练？已有对话会保留，您可以通过当前链接重新打开。")) return;
    openingAbort.current?.abort();
    await live.stop();
    setSession(null); setMessages([]); setEvaluation(null); setError(""); setAudioNotice(""); setDraft(""); setMobileMenu(false); setPracticeMode("choose"); setVoiceTranscriptOpen(false); openingPlayed.current = false;
    window.history.replaceState(null, "", "/");
  };
  const leavePractice = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (active && !window.confirm("离开当前陪练？已有对话会保留，可通过当前链接重新打开。")) {
      event.preventDefault(); return;
    }
    openingAbort.current?.abort();
    void live.stop();
    setMobileMenu(false);
  };

  const userLabel = role === "sales" ? "您 · 销售" : "您 · 客户";
  const aiLabel = role === "sales" ? "AI · 客户" : "AI · 销售";
  const opening = role === "sales" && messages[0]?.role === "customer" ? messages[0].content : "";
  const sceneBrief = industry === "装修"
    ? scene === "电销获客"
      ? { title: "电销获客 · 从第一通电话开始", detail: "练习建立联系、探查装修需求，并争取预约到店或量房。" }
      : scene === "设计师逼单"
        ? { title: "设计师逼单 · 推进方案决策", detail: "围绕到店、量房、方案、报价和签约顾虑展开对话。" }
        : { title: "选择装修部门，开始对应练习", detail: "电销负责前期获客；设计师负责方案与成交沟通。" }
    : industry === "教育课程"
      ? { title: "课程顾问 · 回应报名顾虑", detail: "围绕试听、课程匹配和报名决策进行练习。" }
      : { title: "保险顾问 · 澄清真实需求", detail: "围绕需求分析、保障顾虑和促成进行练习。" };

  const trackPointer = (event: React.PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - .5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - .5) * 2;
    event.currentTarget.style.setProperty("--pointer-x", x.toFixed(3));
    event.currentTarget.style.setProperty("--pointer-y", y.toFixed(3));
  };
  const resetPointer = () => {
    startView.current?.style.setProperty("--pointer-x", "0");
    startView.current?.style.setProperty("--pointer-y", "0");
  };

  const applyPracticeMode = (mode: PracticeMode) => {
    const transitionDocument = document as ViewTransitionDocument;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!transitionDocument.startViewTransition || reduceMotion) {
      setPracticeMode(mode);
      return;
    }
    transitionDocument.startViewTransition(() => flushSync(() => setPracticeMode(mode)));
  };

  const switchPracticeMode = async (mode: PracticeMode) => {
    if (inCall) await live.stop();
    live.clearNotice();
    setVoiceTranscriptOpen(false);
    applyPracticeMode(mode);
  };

  const toggleVoiceCall = async () => {
    if (!session) return;
    live.clearNotice();
    if (inCall) { await live.stop(); return; }
    if (opening && !openingPlayed.current) {
      openingPlayed.current = true;
      const task = playOpening(opening);
      await task;
    }
    setCallSeconds(0);
    await live.start(session.id);
  };

  return <div className="app-shell">
    <aside ref={sidebar} id="workspace-navigation" className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`} aria-label="主导航" role={mobileMenu ? "dialog" : undefined} aria-modal={mobileMenu || undefined}>
      <Brand />
      <button className="icon-button mobile-close" aria-label="关闭导航" onClick={closeMenu}><X size={20} /></button>
      <button className="new-button" onClick={newPractice}><Plus size={17} />新建陪练</button>
      <div className="nav-heading">工作区</div>
      <div className="nav-item nav-active" aria-current="page"><Headphones size={18} />语音陪练</div>
      <Link className="nav-item" href="/assistant" onClick={leavePractice}><MessageCircle size={18} />话术助手</Link>
      <Link className="nav-item" href="/history" onClick={leavePractice}><RotateCcw size={18} />历史记录</Link>
      <div className="sidebar-foot"><ShieldCheck size={16} /><span>体验版 · 不保存录音</span></div>
    </aside>
    {mobileMenu && <button className="menu-scrim" aria-label="关闭导航" onClick={closeMenu} />}
    <div className="main-column" inert={mobileMenu}>
      <header className="topbar"><div className="topbar-left"><button ref={menuButton} className="icon-button mobile-menu" aria-label="打开导航" aria-controls="workspace-navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(true)}><Menu size={20} /></button><span className="breadcrumb">工作区 <span>/</span> 语音陪练</span></div><div className="topbar-right"><span className="preview-dot" />销售陪练体验</div></header>
      <main className="main-content">{loading ? <div className="loading-panel" role="status">正在读取会话…</div> : !session ?
        <section ref={startView} className="start-view" aria-labelledby="start-title" onPointerMove={trackPointer} onPointerLeave={resetPointer}>
          <div className="start-story">
            <div className="eyebrow"><span className="eyebrow-line" /> YANLI · AI SALES COACH</div>
            <h1 id="start-title">把难说的话，<br /><em>练成成交底气。</em></h1>
            <p className="intro">先和 AI 客户练一遍。它会听、会追问，也会在结束后指出真正影响成交的那句话。</p>
            <div className="hero-orb-stage" aria-label="言练 AI 陪练伙伴">
              <span className="orb-caption caption-left">真实异议</span>
              <span className="orb-caption caption-right">即时复盘</span>
              <span className="orb-caption caption-bottom">随时重来</span>
              <AiCustomerAvatar featured />
            </div>
            <div className="hero-proof"><span><strong>2</strong> 种角色</span><span><strong>3</strong> 类行业</span><span><strong>0</strong> 录音留存</span></div>
          </div>
          <div className="setup-card">
            <div className="setup-header"><div><span className="step-label">01 / 02</span><h2>先选择您的角色</h2></div><span className="setup-hint">随时可以开始新一轮</span></div>
            <div className="role-grid" role="group" aria-label="我要扮演的角色">
              <button className={`role-card ${role === "sales" ? "selected" : ""}`} aria-pressed={role === "sales"} onClick={() => setRole("sales")}><span className="role-card-top"><span className="role-symbol"><Headphones size={18} /></span><span className="radio-indicator" /></span><strong>我扮销售</strong><span>AI 扮客户，向我提出真实异议</span><small>练完获得评分与改进建议</small></button>
              <button className={`role-card ${role === "customer" ? "selected" : ""}`} aria-pressed={role === "customer"} onClick={() => setRole("customer")}><span className="role-card-top"><span className="role-symbol accent"><MessageCircle size={18} /></span><span className="radio-indicator" /></span><strong>我扮客户</strong><span>向 AI 销售发问，观察它如何应对</span><small>结束后看示范拆解，不给您打分</small></button>
            </div>
            <div className="setup-divider" />
            <div className="setup-header second"><div><span className="step-label">02 / 02</span><h2>设定陪练场景</h2></div></div>
            <div className="field-grid">
              <label className="field"><span>行业</span><div className="select-wrap"><select value={industry} onChange={(event) => { setIndustry(event.target.value as Industry); setScene(null); }}>{industries.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></div></label>
              <label className="field"><span>客户类型</span><div className="select-wrap"><select value={customerType} onChange={(event) => setCustomerType(event.target.value as CustomerType)}>{customerTypes.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></div></label>
              <label className="field"><span>刁难程度</span><div className="select-wrap"><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>{difficulties.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></div></label>
            </div>
            {industry === "装修" && <div className="scene-selector" role="group" aria-label="装修部门／场景">
              <div className="scene-selector-title"><span>装修部门／场景</span><small>请选择本轮要练习的部门</small></div>
              <div className="scene-options">
                <button type="button" className={`scene-option ${scene === "电销获客" ? "selected" : ""}`} aria-pressed={scene === "电销获客"} onClick={() => setScene("电销获客" as DecorationScene)}><span className="scene-option-icon"><PhoneCall size={18} /></span><span><strong>电销获客</strong><small>电话沟通 · 争取预约</small></span><span className="scene-check" /></button>
                <button type="button" className={`scene-option ${scene === "设计师逼单" ? "selected" : ""}`} aria-pressed={scene === "设计师逼单"} onClick={() => setScene("设计师逼单" as DecorationScene)}><span className="scene-option-icon"><PenTool size={18} /></span><span><strong>设计师逼单</strong><small>方案报价 · 推进签约</small></span><span className="scene-check" /></button>
              </div>
            </div>}
            <div className="practice-brief" aria-live="polite"><span className="brief-icon"><Sparkles size={18} /></span><div><strong>{sceneBrief.title}</strong><span>{role === "sales" ? "您扮销售。" : "您扮客户，观察 AI 销售示范。"}{sceneBrief.detail}</span></div></div>
            {error && <div className="error-banner" role="alert">{error}</div>}
            <div className="setup-footer"><span><ShieldCheck size={15} />不留录音，保留文字与结果</span><button className="primary-button" disabled={busy || (industry === "装修" && !scene)} onClick={begin}>{busy ? "正在创建…" : "开始陪练"}<ArrowRight size={18} /></button></div>
          </div>
        </section> :
        <section className="practice-view" aria-label="当前陪练">
          <div className="practice-heading"><div><div className="eyebrow compact">LIVE PRACTICE <span className="heading-dot" /></div><h1>{role === "sales" ? "练习如何回应客户" : "观察 AI 如何销售"}</h1><p>{session.industry} <span>·</span> {session.scene ?? (session.industry === "装修" ? "旧记录·未区分部门" : "通用场景")} <span>·</span> {session.customer_type} <span>·</span> {session.difficulty}</p></div><div className="role-pill">{role === "sales" ? "您是销售 · AI 是客户" : "您是客户 · AI 是销售"}</div></div>
          {error && <div className="error-banner" role="alert">{error}</div>}
          {active && practiceMode === "choose" && <section className="mode-choice" aria-labelledby="mode-choice-title">
            <div className="mode-choice-copy"><span className="step-label">选择练习方式</span><h2 id="mode-choice-title">这轮，您想怎么开口？</h2><p>两种方式使用同一位 AI 客户和同一套点评标准，过程中也可以随时切换。</p></div>
            <div className="mode-choice-grid">
              <button className="mode-card mode-card-voice" onClick={() => void switchPracticeMode("voice")}>
                <span className="mode-card-visual"><span className="mini-voice-ring" /><AiCustomerAvatar featured tone="light" /></span>
                <span className="mode-card-kicker"><AudioLines size={15} />沉浸练习</span>
                <strong>实时语音通话</strong>
                <span>像电话一样连续对话，停顿后 AI 自动回应。</span>
                <span className="mode-card-action">进入语音模式 <ArrowRight size={17} /></span>
              </button>
              <button className="mode-card mode-card-text" onClick={() => void switchPracticeMode("text")}>
                <span className="mode-card-visual text-preview" aria-hidden="true"><span>客户：我现在没时间。</span><span>您：理解，只占用您一分钟…</span><i /></span>
                <span className="mode-card-kicker"><Keyboard size={15} />安静练习</span>
                <strong>打字对话</strong>
                <span>不打开麦克风，逐句思考后再发送。</span>
                <span className="mode-card-action">进入打字模式 <ArrowRight size={17} /></span>
              </button>
            </div>
            <div className="mode-privacy"><ShieldCheck size={15} />语音不落盘；两种模式都只保存文字与练习结果</div>
          </section>}

          {practiceMode === "voice" && <section className={`voice-room voice-room-${live.status}`} aria-label="实时语音通话">
            <div className="practice-mode-bar"><button onClick={() => void switchPracticeMode("choose")}><ChevronLeft size={17} />选择方式</button><span><AudioLines size={15} />实时语音</span><button onClick={() => void switchPracticeMode("text")}><Keyboard size={16} />切换打字</button></div>
            <div className="voice-room-stage">
              <div className="voice-ambient" aria-hidden="true"><span /><span /><span /></div>
              <div className="voice-room-label">{role === "sales" ? "AI CUSTOMER" : "AI SALES COACH"}</div>
              <AiCustomerAvatar state={active ? live.status : "idle"} featured tone="light" followPointer={!inCall} />
              <div className="voice-room-status" role="status"><strong>{active ? callText[live.status][0] : "本轮练习已结束"}</strong><span>{live.partial || (active ? callText[live.status][1] : "对话与结果已保留")}</span></div>
              {active && <div className="voice-primary-controls">
                <button className={`voice-main-button ${inCall ? "is-live" : ""} ${live.status === "connecting" ? "is-connecting" : ""}`} disabled={busy || openingBusy} onClick={() => void toggleVoiceCall()} aria-label={inCall ? "结束实时通话" : "开始实时通话"}>{inCall ? <X size={25} /> : <Mic size={25} />}</button>
                <span className="voice-call-meta">{openingBusy ? "正在播放开场" : live.status === "connecting" ? "正在建立通话" : inCall ? `结束通话 · ${formatCallDuration(callSeconds)}` : live.status === "disconnected" ? "重新连接" : "开始通话"}</span>
              </div>}
              <div className="voice-room-actions">
                {opening && <button disabled={openingBusy || inCall} onClick={() => void playOpening(opening)}><Volume2 size={15} />重听开场</button>}
                <button onClick={() => setVoiceTranscriptOpen((value) => !value)}><MessageCircle size={15} />{voiceTranscriptOpen ? "收起转写" : "查看转写"}</button>
                {active && <button disabled={busy} onClick={finish}>{busy ? "生成结果中" : role === "sales" ? "结束并点评" : "结束并看示范"}</button>}
              </div>
            </div>
            {(live.notice || audioNotice) && <div className="notice-banner voice-notice" role="alert">{live.notice || audioNotice}</div>}
            {voiceTranscriptOpen && <div className="voice-transcript" aria-live="polite"><div><strong>实时转写</strong><span>仅保存文字，不保存原始录音</span></div>{messages.length === 0 ? <p>通话开始后，双方的文字记录会出现在这里。</p> : messages.map((message) => <p key={message.id}><b>{message.role === role ? userLabel : aiLabel}</b>{message.content}</p>)}</div>}
          </section>}

          {practiceMode === "text" && <section className="text-room" aria-label="打字陪练">
            {active && <div className="practice-mode-bar"><button onClick={() => void switchPracticeMode("choose")}><ChevronLeft size={17} />选择方式</button><span><Keyboard size={15} />打字对话</span><button onClick={() => void switchPracticeMode("voice")}><AudioLines size={16} />切换语音</button></div>}
            <div className="text-room-card">
              <div className="conversation-head"><div><span className="conversation-icon"><MessageCircle size={18} /></span><div><strong>打字陪练</strong><small>{active ? "逐句思考，不需要开启麦克风" : session.status === "abandoned" ? "本次练习已放弃，对话记录仍然保留" : "本次练习已结束"}</small></div></div><span className="session-dot">{active ? "进行中" : session.status === "abandoned" ? "已放弃" : "已结束"}</span></div>
              <div className="message-list" aria-live="polite">
                {messages.length === 0 && <div className="empty-chat"><div className="empty-chat-icon"><MessageCircle size={22} /></div><strong>轮到您先开口</strong><span>试着提出一个客户会问的问题，看看 AI 销售如何回应。</span></div>}
                {messages.map((message) => { const user = message.role === role; return <div className={`message-row ${user ? "message-user" : "message-ai"}`} key={message.id}><div className={`message-avatar ${!user ? "bot-avatar-wrap" : ""}`}>{user ? "我" : <AiCustomerAvatar state="idle" />}</div><div><div className="message-meta">{user ? userLabel : aiLabel}</div><div className="message-bubble">{message.content}</div></div></div>; })}
                {busy && active && <div className="processing-hint">AI 正在组织回应…</div>}
                <div ref={messagesEnd} />
              </div>
              {active && <div className="text-room-composer"><div className="text-input-row"><input aria-label={role === "sales" ? "输入销售回复" : "输入客户提问"} placeholder={role === "sales" ? "输入您想说的销售回复…" : "输入一个客户会问的问题…"} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void send(); } }} disabled={busy} /><button aria-label="发送文字" onClick={send} disabled={!draft.trim() || busy}><Send size={18} /></button></div><button className="end-button" disabled={busy} onClick={finish}>{busy ? "正在生成…" : role === "sales" ? "结束并点评" : "结束并看示范"}</button></div>}
            </div>
          </section>}
          {evaluation && <section className="result-card" aria-label="练习结果"><div className="result-title"><span className="result-icon"><Sparkles size={19} /></span><div><span className="step-label">PRACTICE REVIEW</span><h2>{evaluation.kind === "score" ? "本次销售表现" : "AI 销售示范拆解"}</h2></div></div>{evaluation.kind === "score" ? <><div className="score-line"><strong>{evaluation.score}</strong><span>/ 100 分</span></div><p className="result-summary">{evaluation.tone}</p></> : <p className="result-summary demo-summary">{evaluation.summary}</p>}<div className="highlights">{evaluation.highlights.map((highlight, index) => <div className="highlight" key={`${index}-${highlight.point}`}><span className={`highlight-tag ${highlight.type}`}>{highlight.type === "good" ? "值得借鉴" : "可以改进"}</span><strong>{highlight.point}</strong><p>{highlight.demo}</p></div>)}</div><button className="secondary-button" onClick={newPractice}><Plus size={17} />开始新的陪练</button></section>}
          {session.status === "evaluated" && !evaluation && <div className="notice-banner" role="status">练习已结束，暂未读取到结果。请刷新页面重试。</div>}
        </section>}
      </main>
      <footer className="page-footer"><span>言练 · 销售新人陪练</span><span>练习记录只保存文字，不保存原始录音</span></footer>
    </div>
  </div>;
}

export default function Home() {
  if (process.env.NEXT_PUBLIC_SITE_MODE === "landing") return <LandingPage />;
  return <ProductHome />;
}
