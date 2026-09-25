"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowRight, Copy, MessageCircle, Send, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { WorkspaceFrame } from "@/components/WorkspaceFrame";
import { AiCustomerAvatar } from "@/components/AiCustomerAvatar";
import { askAssistant } from "@/lib/api";
import type { Industry } from "@/lib/types";

type Turn = { id: string; question: string; answer: string };
const industries: Industry[] = ["装修", "教育课程", "保险"];
const examples = ["客户说太贵了，怎么回应？", "第一次跟进客户，下一步怎么做？", "客户总说再考虑一下，怎样问清顾虑？"];
const exampleGazes = [{ x: -.78, y: .25 }, { x: 0, y: .35 }, { x: .78, y: .25 }];
type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

export default function AssistantPage() {
  const [industry, setIndustry] = useState<Industry | "">("");
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [focusedExample, setFocusedExample] = useState<number | null>(null);
  const submitting = useRef(false);

  const ask = async (value = draft) => {
    const question = value.trim();
    if (!question || question.length > 2000 || submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setNotice(""); setDraft("");
    const id = crypto.randomUUID();
    const appendTurn = () => setTurns((previous) => [...previous, { id, question, answer: "" }]);
    const transitionDocument = document as ViewTransitionDocument;
    if (turns.length === 0 && transitionDocument.startViewTransition && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      transitionDocument.startViewTransition(() => flushSync(appendTurn));
    } else appendTurn();
    let answer = "";
    try {
      await askAssistant(question, industry || null, {
        onChunk: (text) => {
          answer += text;
          setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, answer } : turn));
        },
        onDone: (text) => {
          answer = text || answer;
          setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, answer } : turn));
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回答失败，请重试");
      setDraft(question);
      if (!answer) setTurns((previous) => previous.filter((turn) => turn.id !== id));
    } finally { submitting.current = false; setBusy(false); }
  };

  const copy = async (answer: string) => {
    try { await navigator.clipboard.writeText(answer); setNotice("回答已复制"); }
    catch { setNotice("复制失败，请手动选择文字"); }
  };

  return <WorkspaceFrame section="assistant"><section className="workspace-view assistant-view">
    <div className="workspace-heading"><div className="eyebrow compact">SALES ASSISTANT <span className="heading-dot" /></div><h1>有问题，先问话术助手。</h1><p>问话术、产品知识或跟进建议。回答供您参考，涉及报价和承诺请以真实资料核实。</p></div>
    <div className="assistant-card">
      <div className="assistant-card-head"><span className="conversation-icon"><MessageCircle size={18} /></span><div><strong>文字问答</strong><small>当前页面内的问答在刷新后不会恢复</small></div></div>
      {turns.length === 0 ? <div className="assistant-empty"><span className="assistant-agent"><AiCustomerAvatar followPointer={false} gaze={focusedExample === null ? undefined : exampleGazes[focusedExample]} /></span><h2>从一个真实问题开始</h2><p>描述您遇到的客户异议，或询问下一步怎么跟进。</p><div className="prompt-grid">{examples.map((example, index) => <button key={example} onPointerEnter={() => setFocusedExample(index)} onPointerLeave={() => setFocusedExample(null)} onFocus={() => setFocusedExample(index)} onBlur={() => setFocusedExample(null)} onClick={() => void ask(example)} disabled={busy}>{example}<ArrowRight size={15} /></button>)}</div></div> :
        <div className="assistant-turns">{turns.map((turn) => { const isLatest = turn === turns.at(-1); return <div className="assistant-turn" key={turn.id}><div className="assistant-question"><span>您问</span><p>{turn.question}</p></div><div className="assistant-answer"><span className="assistant-label"><span className="assistant-response-orb"><AiCustomerAvatar state={busy && isLatest ? "thinking" : "idle"} followPointer={false} /></span><Sparkles size={15} />AI 建议</span><div className="assistant-markdown">{turn.answer ? <ReactMarkdown>{turn.answer}</ReactMarkdown> : <p>{busy && isLatest ? "正在组织回答…" : "本次未收到回答"}</p>}</div>{turn.answer && <button className="copy-button" onClick={() => void copy(turn.answer)}><Copy size={14} />复制回答</button>}</div></div>; })}</div>}
      <p className="sr-only" role="status">{busy ? "AI 正在回答" : turns.length > 0 ? "AI 回答已结束" : ""}</p>
      <div className="assistant-composer"><label htmlFor="assistant-industry">行业背景</label><select id="assistant-industry" value={industry} onChange={(event) => setIndustry(event.target.value as Industry | "")}><option value="">通用销售</option>{industries.map((item) => <option key={item} value={item}>{item}</option>)}</select><label htmlFor="assistant-question">您的问题</label><div className="assistant-input-row"><textarea id="assistant-question" rows={3} maxLength={2000} placeholder="例如：客户觉得报价太贵，我该怎么问清他的顾虑？" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(); } }} /><button className="primary-button" disabled={busy || !draft.trim()} onClick={() => void ask()}><Send size={16} />{busy ? "回答中…" : "发送问题"}</button></div></div>
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="notice-banner" role="status">{notice}</div>}
  </section></WorkspaceFrame>;
}
