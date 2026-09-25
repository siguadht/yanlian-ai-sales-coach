"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, CalendarDays, RotateCcw } from "lucide-react";
import { WorkspaceFrame } from "@/components/WorkspaceFrame";
import { getSession, listSessions } from "@/lib/api";
import type { HistorySession, PlayerRole } from "@/lib/types";

type Filter = "all" | PlayerRole;
const dateLabel = (value: string | null) => {
  if (!value) return "时间未知";
  // SQLite returns the backend's UTC timestamp without a timezone suffix.
  const date = new Date(/(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
};
const asDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(/(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const dateGroup = (value: string | null) => {
  const date = asDate(value);
  if (!date) return "更早";
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((todayStart - dateStart) / 86_400_000);
  return days <= 0 ? "今天" : days < 7 ? "最近 7 天" : "更早";
};
const dateGroupId = (label: string) => label === "今天" ? "today" : label === "最近 7 天" ? "recent" : "earlier";

export default function HistoryPage() {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(10);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [insights, setInsights] = useState<Record<string, string>>({});
  const [insightLoading, setInsightLoading] = useState<Record<string, boolean>>({});
  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setSessions(await listSessions()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "历史记录读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    listSessions().then((items) => { if (active) setSessions(items); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "历史记录读取失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => filter === "all" ? sessions : sessions.filter((session) => session.player_role === filter), [sessions, filter]);
  const scored = useMemo(() => sessions.filter((session) => session.player_role === "sales" && session.score !== null).reverse(), [sessions]);
  const recent = scored.slice(-12);
  const average = scored.length ? Math.round(scored.reduce((total, session) => total + (session.score ?? 0), 0) / scored.length) : null;
  const latestActive = sessions.find((session) => session.status === "in_progress") ?? null;
  const displayed = visible.slice(0, visibleLimit);
  const grouped = useMemo(() => {
    const groups = new Map<string, HistorySession[]>();
    for (const session of displayed) {
      const label = dateGroup(session.created_at);
      groups.set(label, [...(groups.get(label) ?? []), session]);
    }
    return [...groups.entries()];
  }, [displayed]);

  const chooseFilter = (next: Filter) => { setFilter(next); setVisibleLimit(10); setSelectedSession(null); };
  const focusFromTrend = (id: string) => {
    setFilter("sales");
    setVisibleLimit(sessions.length);
    setSelectedSession(id);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`history-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })));
  };
  const loadInsight = async (session: HistorySession) => {
    if (session.status !== "evaluated" || insights[session.id] || insightLoading[session.id]) return;
    setInsightLoading((current) => ({ ...current, [session.id]: true }));
    try {
      const detail = await getSession(session.id);
      const highlight = detail.evaluation?.highlights.find((item) => item.type === "bad") ?? detail.evaluation?.highlights[0];
      setInsights((current) => ({ ...current, [session.id]: highlight?.point || "打开记录查看完整复盘" }));
    } catch {
      setInsights((current) => ({ ...current, [session.id]: "打开记录查看完整复盘" }));
    } finally {
      setInsightLoading((current) => ({ ...current, [session.id]: false }));
    }
  };

  return <WorkspaceFrame section="history"><section className="workspace-view history-view">
    <div className="workspace-heading"><div className="eyebrow compact">PRACTICE HISTORY <span className="heading-dot" /></div><h1>回看每一次练习。</h1><p>销售练习看分数与进步，客户观摩看 AI 销售示范。</p></div>
    {latestActive && <Link className="continue-practice" href={`/?session=${encodeURIComponent(latestActive.id)}`}><span><small>CONTINUE PRACTICE</small><strong>继续上次练习</strong><em>{latestActive.industry} · {latestActive.scene ?? "通用场景"} · {latestActive.customer_type}</em></span><span>继续练习 <ArrowRight size={18} /></span></Link>}
    <div className="history-stats"><div><span>陪练次数</span><strong>{sessions.length}</strong><small>当前体验者的练习记录</small></div><div><span>已评分销售练习</span><strong>{scored.length}</strong><small>仅统计有分数的销售练习</small></div><div><span>销售平均分</span><strong>{average === null ? "—" : average}</strong><small>仅按有分数的销售练习计算</small></div></div>
    <section className="trend-card" aria-label="销售分数趋势"><div className="section-heading"><div><BarChart3 size={18} /><h2>销售分数趋势</h2></div><span>最近 {recent.length} 次有评分的销售练习</span></div>{recent.length ? <div className="trend-bars" role="img" aria-label={`最近 ${recent.length} 次销售练习分数：${recent.map((item) => item.score).join("、")}`}>
      {recent.map((item, index) => <button className={`trend-column ${selectedSession === item.id ? "selected" : ""}`} key={item.id} onClick={() => focusFromTrend(item.id)} aria-label={`第 ${index + 1} 次练习，${item.score} 分，点击定位到记录`}><strong>{item.score}</strong><span className="trend-track"><span style={{ height: `${item.score}%` }} /></span><small>{index + 1}</small></button>)}
    </div> : <div className="trend-empty">完成一次“我扮销售”的练习后，这里会显示真实分数。客户观摩记录不计分。</div>}</section>
    <section className="history-card" aria-label="陪练记录"><div className="section-heading"><div><RotateCcw size={18} /><h2>陪练记录</h2></div><div className="history-filters" role="group" aria-label="筛选角色">{(["all", "sales", "customer"] as Filter[]).map((item) => <button key={item} className={filter === item ? "selected" : ""} aria-pressed={filter === item} onClick={() => chooseFilter(item)}>{item === "all" ? "全部" : item === "sales" ? "我扮销售" : "我扮客户"}</button>)}</div></div>
      {loading ? <div className="history-empty" role="status">正在读取记录…</div> : error ? <div className="history-empty error-state" role="alert">{error}<button onClick={() => void reload()}>重试</button></div> : visible.length === 0 ? <div className="history-empty">{sessions.length ? "该角色还没有练习记录。" : "暂无练习记录。完成一次陪练后会出现在这里。"}</div> : <div className="history-list">{grouped.map(([label, items]) => { const groupHeadingId = `history-group-${dateGroupId(label)}`; return <section className="history-group" key={label} aria-labelledby={groupHeadingId}><div className="history-group-title" id={groupHeadingId}><span>{label}</span><small>{items.length} 条</small></div>{items.map((item) => <Link id={`history-${item.id}`} className={`history-row ${selectedSession === item.id ? "selected" : ""}`} href={`/?session=${encodeURIComponent(item.id)}`} key={item.id} onMouseEnter={() => void loadInsight(item)} onFocus={() => void loadInsight(item)}><span className="history-role">{item.player_role === "sales" ? "销售练习" : "客户观摩"}</span><span className="history-main"><strong>{item.industry} · {item.scene ?? (item.industry === "装修" ? "未区分部门" : "通用场景")} · {item.customer_type}</strong><small><CalendarDays size={13} />{dateLabel(item.created_at)} · {item.difficulty} · {item.status === "evaluated" ? "已结束" : item.status === "abandoned" ? "已放弃" : "进行中"}</small>{item.status === "evaluated" && <em className="history-insight">{insightLoading[item.id] ? "正在读取复盘重点…" : insights[item.id] ? `复盘重点：${insights[item.id]}` : "悬停查看复盘重点"}</em>}</span><span className="history-score">{item.score !== null ? `${item.score} 分` : item.status === "evaluated" && item.player_role === "customer" ? "示范拆解" : item.status === "abandoned" ? "已放弃" : "未评分"}</span><ArrowRight className="history-arrow" size={17} /></Link>)}</section>; })}{visible.length > displayed.length && <button className="history-more" onClick={() => setVisibleLimit((count) => count + 10)}>再显示 10 条 <ArrowRight size={15} /></button>}</div>}
    </section>
    <p className="history-boundary">分享体验时每位体验者使用独立体验码，记录分别保存。分数趋势仅供练习参考。</p>
  </section></WorkspaceFrame>;
}
